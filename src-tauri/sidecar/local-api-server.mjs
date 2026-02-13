#!/usr/bin/env node
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const port = Number(process.env.LOCAL_API_PORT || 46123);
const remoteBase = (process.env.LOCAL_API_REMOTE_BASE || 'https://worldmonitor.app').replace(/\/$/, '');
const resourceDir = process.env.LOCAL_API_RESOURCE_DIR || process.cwd();
const apiDir = path.join(resourceDir, 'api');
const mode = process.env.LOCAL_API_MODE || 'desktop-sidecar';

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

function isBracketSegment(segment) {
  return segment.startsWith('[') && segment.endsWith(']');
}

function splitRoutePath(routePath) {
  return routePath.split('/').filter(Boolean);
}

function routePriority(routePath) {
  const parts = splitRoutePath(routePath);
  return parts.reduce((score, part) => {
    if (part.startsWith('[[...') && part.endsWith(']]')) return score + 0;
    if (part.startsWith('[...') && part.endsWith(']')) return score + 1;
    if (isBracketSegment(part)) return score + 2;
    return score + 10;
  }, 0);
}

function matchRoute(routePath, pathname) {
  const routeParts = splitRoutePath(routePath);
  const pathParts = splitRoutePath(pathname.replace(/^\/api/, ''));

  let i = 0;
  let j = 0;

  while (i < routeParts.length && j < pathParts.length) {
    const routePart = routeParts[i];
    const pathPart = pathParts[j];

    if (routePart.startsWith('[[...') && routePart.endsWith(']]')) {
      return true;
    }

    if (routePart.startsWith('[...') && routePart.endsWith(']')) {
      return true;
    }

    if (isBracketSegment(routePart)) {
      i += 1;
      j += 1;
      continue;
    }

    if (routePart !== pathPart) {
      return false;
    }

    i += 1;
    j += 1;
  }

  if (i === routeParts.length && j === pathParts.length) return true;

  if (i === routeParts.length - 1) {
    const tail = routeParts[i];
    if (tail?.startsWith('[[...') && tail.endsWith(']]')) {
      return true;
    }
    if (tail?.startsWith('[...') && tail.endsWith(']')) {
      return j < pathParts.length;
    }
  }

  return false;
}

async function buildRouteTable(root) {
  const files = [];

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.name.endsWith('.js')) continue;
      if (entry.name.startsWith('_')) continue;

      const relative = path.relative(root, absolute).replace(/\\/g, '/');
      const routePath = relative.replace(/\.js$/, '').replace(/\/index$/, '');
      files.push({ routePath, modulePath: absolute });
    }
  }

  await walk(root);

  files.sort((a, b) => routePriority(b.routePath) - routePriority(a.routePath));
  return files;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function toHeaders(nodeHeaders) {
  const headers = new Headers();
  Object.entries(nodeHeaders).forEach(([key, value]) => {
    if (key.toLowerCase() === 'host') return;
    if (Array.isArray(value)) {
      value.forEach(v => headers.append(key, v));
    } else if (typeof value === 'string') {
      headers.set(key, value);
    }
  });
  return headers;
}

async function handleServiceStatus() {
  return json({
    success: true,
    timestamp: new Date().toISOString(),
    summary: { operational: 2, degraded: 0, outage: 0, unknown: 0 },
    services: [
      { id: 'local-api', name: 'Local Desktop API', category: 'dev', status: 'operational', description: `Running on 127.0.0.1:${port}` },
      { id: 'cloud-pass-through', name: 'Cloud pass-through', category: 'cloud', status: 'operational', description: `Fallback target ${remoteBase}` },
    ],
    local: { enabled: true, mode, port, remoteBase },
  });
}

async function proxyToCloud(requestUrl, req) {
  const target = `${remoteBase}${requestUrl.pathname}${requestUrl.search}`;
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
  return fetch(target, {
    method: req.method,
    headers: toHeaders(req.headers),
    body,
  });
}

function pickModule(pathname, routes) {
  const apiPath = pathname.startsWith('/api') ? pathname.slice(4) || '/' : pathname;

  for (const candidate of routes) {
    if (matchRoute(candidate.routePath, apiPath)) {
      return candidate.modulePath;
    }
  }

  return null;
}

const moduleCache = new Map();

async function importHandler(modulePath) {
  const cacheKey = modulePath;
  const cached = moduleCache.get(cacheKey);
  if (cached) return cached;

  const mod = await import(pathToFileURL(modulePath).href);
  moduleCache.set(cacheKey, mod);
  return mod;
}

async function dispatch(requestUrl, req, routes) {
  if (requestUrl.pathname === '/api/service-status') {
    return handleServiceStatus();
  }
  if (requestUrl.pathname === '/api/local-status') {
    return json({ success: true, mode, port, apiDir, remoteBase, routes: routes.length });
  }

  const modulePath = pickModule(requestUrl.pathname, routes);
  if (!modulePath || !existsSync(modulePath)) {
    return proxyToCloud(requestUrl, req);
  }

  try {
    const mod = await importHandler(modulePath);
    if (typeof mod.default !== 'function') {
      return json({ error: `Invalid handler module: ${path.basename(modulePath)}` }, 500);
    }

    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
    const request = new Request(requestUrl.toString(), {
      method: req.method,
      headers: toHeaders(req.headers),
      body,
    });

    const response = await mod.default(request);
    if (!(response instanceof Response)) {
      return json({ error: `Handler returned invalid response for ${requestUrl.pathname}` }, 500);
    }
    return response;
  } catch (error) {
    console.error('[local-api] local handler failed, trying cloud fallback', requestUrl.pathname, error);
    try {
      return await proxyToCloud(requestUrl, req);
    } catch {
      return json({ error: 'Local handler failed and cloud fallback unavailable' }, 502);
    }
  }
}

const routes = await buildRouteTable(apiDir);

createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${port}`);

  if (!requestUrl.pathname.startsWith('/api/')) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  try {
    const response = await dispatch(requestUrl, req, routes);
    const body = Buffer.from(await response.arrayBuffer());
    const headers = Object.fromEntries(response.headers.entries());
    res.writeHead(response.status, headers);
    res.end(body);
  } catch (error) {
    console.error('[local-api] fatal', error);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`[local-api] listening on http://127.0.0.1:${port} (apiDir=${apiDir}, routes=${routes.length})`);
});
