/**
 * Standalone Node.js server for WorldMonitor
 * Replaces Vercel edge functions with a single process.
 *
 * Usage:
 *   node server.js                       # serves "full" variant (default)
 *   VITE_VARIANT=tech node server.js     # serves "tech" variant
 *
 * Requires Node.js 18+ (native fetch, Request, Response).
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, statSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);
const DIST_DIR = join(__dirname, 'dist');

// ── MIME types ──
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.xml':  'application/xml',
  '.txt':  'text/plain; charset=utf-8',
  '.map':  'application/json',
};

// ── Discover API handlers ──
// Walk the api/ directory and build a route map.
// Vercel convention:
//   api/foo.js           → /api/foo
//   api/foo/bar.js       → /api/foo/bar
//   api/eia/[[...path]].js → /api/eia/* (catch-all)
//   api/wingbits/details/[icao24].js → /api/wingbits/details/:icao24

const apiDir = join(__dirname, 'api');
const routes = [];       // { pattern: RegExp, module: Promise<{default}> }
const exactRoutes = {};  // path → module

function walkDir(dir, prefix) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const s = statSync(fullPath);

    if (s.isDirectory()) {
      // Skip data/ and test files
      if (entry === 'data' || entry === 'node_modules') continue;
      walkDir(fullPath, `${prefix}/${entry}`);
      continue;
    }

    if (!entry.endsWith('.js') || entry.startsWith('_') || entry.endsWith('.test.mjs') || entry.endsWith('.test.js')) {
      continue;
    }

    const baseName = entry.replace(/\.js$/, '');
    const modulePath = fullPath;

    // Catch-all: [[...path]].js or [...path].js
    if (baseName.includes('[[...') || baseName.includes('[...')) {
      const routePrefix = prefix; // e.g. /api/eia
      routes.push({
        pattern: new RegExp(`^${routePrefix}(/.*)?$`),
        modulePath,
        prefix: routePrefix,
      });
      continue;
    }

    // Dynamic segment: [param].js
    if (baseName.startsWith('[') && baseName.endsWith(']')) {
      const paramName = baseName.slice(1, -1);
      const routePattern = `${prefix}/([^/]+)`;
      routes.push({
        pattern: new RegExp(`^${routePattern}$`),
        modulePath,
        prefix,
      });
      continue;
    }

    // Exact route
    const routePath = `${prefix}/${baseName}`;
    exactRoutes[routePath] = modulePath;
  }
}

walkDir(apiDir, '/api');

// Cache loaded modules
const moduleCache = new Map();

async function loadHandler(modulePath) {
  if (moduleCache.has(modulePath)) return moduleCache.get(modulePath);
  const mod = await import(modulePath);
  moduleCache.set(modulePath, mod.default);
  return mod.default;
}

// ── Convert Node.js req to Web Request, and Web Response back to Node.js res ──

function toWebRequest(req, body) {
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  const url = `${protocol}://${host}${req.url}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }

  const init = {
    method: req.method,
    headers,
  };

  // Attach body for non-GET/HEAD
  if (body && req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = body;
  }

  return new Request(url, init);
}

async function sendWebResponse(webRes, res) {
  res.statusCode = webRes.status;

  for (const [key, value] of webRes.headers.entries()) {
    res.setHeader(key, value);
  }

  if (webRes.body) {
    const reader = webRes.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } finally {
      reader.releaseLock();
    }
  }

  res.end();
}

// ── Static file serving ──

async function serveStatic(reqPath, res) {
  // Prevent directory traversal
  const safePath = reqPath.replace(/\.\./g, '').replace(/\/\//g, '/');
  let filePath = join(DIST_DIR, safePath);

  try {
    const s = await stat(filePath);
    if (s.isDirectory()) {
      filePath = join(filePath, 'index.html');
    }
  } catch {
    // File doesn't exist — SPA fallback
    filePath = join(DIST_DIR, 'index.html');
  }

  try {
    const data = await readFile(filePath);
    const ext = extname(filePath);
    const mime = MIME[ext] || 'application/octet-stream';

    // Cache immutable hashed assets
    if (safePath.startsWith('/assets/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }

    res.setHeader('Content-Type', mime);
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

// ── Request handler ──

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // ── API routes ──
  if (pathname.startsWith('/api/')) {
    // Collect body for POST/PUT/PATCH
    let body = null;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = Buffer.concat(chunks);
    }

    const webReq = toWebRequest(req, body);

    try {
      // 1. Try exact match
      if (exactRoutes[pathname]) {
        const handler = await loadHandler(exactRoutes[pathname]);
        const webRes = await handler(webReq);
        return sendWebResponse(webRes, res);
      }

      // 2. Try pattern routes (catch-all, dynamic segments)
      for (const route of routes) {
        if (route.pattern.test(pathname)) {
          const handler = await loadHandler(route.modulePath);
          const webRes = await handler(webReq);
          return sendWebResponse(webRes, res);
        }
      }

      // 3. No matching API route
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (err) {
      console.error(`[API Error] ${pathname}:`, err);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
    return;
  }

  // ── Static files ──
  const served = await serveStatic(pathname, res);
  if (!served) {
    // SPA fallback — serve index.html for all non-file routes
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    try {
      const html = await readFile(join(DIST_DIR, 'index.html'));
      res.end(html);
    } catch {
      res.statusCode = 404;
      res.end('Not found');
    }
  }
}

// ── Start server ──

const server = createServer(handleRequest);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[WorldMonitor] Listening on http://0.0.0.0:${PORT}`);
  console.log(`[WorldMonitor] Variant: ${process.env.VITE_VARIANT || 'full'}`);
});
