const DEFAULT_REMOTE_HOSTS: Record<string, string> = {
  tech: 'https://tech.worldmonitor.app',
  full: 'https://worldmonitor.app',
  world: 'https://worldmonitor.app',
};

const DEFAULT_LOCAL_API_BASE = 'http://127.0.0.1:46123';

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

export function isDesktopRuntime(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const hasTauriGlobals = '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
  const userAgent = window.navigator?.userAgent ?? '';
  const tauriInUserAgent = userAgent.includes('Tauri');

  return hasTauriGlobals || tauriInUserAgent;
}

export function getApiBaseUrl(): string {
  if (!isDesktopRuntime()) {
    return '';
  }

  const configuredBaseUrl = import.meta.env.VITE_TAURI_API_BASE_URL;
  if (configuredBaseUrl) {
    return normalizeBaseUrl(configuredBaseUrl);
  }

  return DEFAULT_LOCAL_API_BASE;
}

export function getRemoteApiBaseUrl(): string {
  const configuredRemoteBase = import.meta.env.VITE_TAURI_REMOTE_API_BASE_URL;
  if (configuredRemoteBase) {
    return normalizeBaseUrl(configuredRemoteBase);
  }

  const variant = import.meta.env.VITE_VARIANT || 'world';
  return DEFAULT_REMOTE_HOSTS[variant] ?? DEFAULT_REMOTE_HOSTS.world ?? 'https://worldmonitor.app';
}

export function toRuntimeUrl(path: string): string {
  if (!path.startsWith('/')) {
    return path;
  }

  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    return path;
  }

  return `${baseUrl}${path}`;
}

function getApiTargetFromRequestInput(input: RequestInfo | URL): string | null {
  if (typeof input === 'string') {
    if (input.startsWith('/')) return input;
    try {
      const u = new URL(input);
      return `${u.pathname}${u.search}`;
    } catch {
      return null;
    }
  }

  if (input instanceof URL) {
    return `${input.pathname}${input.search}`;
  }

  try {
    const u = new URL(input.url);
    return `${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

export function installRuntimeFetchPatch(): void {
  if (!isDesktopRuntime() || typeof window === 'undefined' || (window as unknown as Record<string, unknown>).__wmFetchPatched) {
    return;
  }

  const nativeFetch = window.fetch.bind(window);
  const localBase = getApiBaseUrl();
  const remoteBase = getRemoteApiBaseUrl();

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const target = getApiTargetFromRequestInput(input);
    if (!target?.startsWith('/api/')) {
      return nativeFetch(input, init);
    }

    const localUrl = `${localBase}${target}`;
    const remoteUrl = `${remoteBase}${target}`;

    try {
      return await nativeFetch(localUrl, init);
    } catch (error) {
      console.warn(`[runtime] Local API fetch failed for ${target}, falling back to cloud`, error);
      return nativeFetch(remoteUrl, init);
    }
  };

  (window as unknown as Record<string, unknown>).__wmFetchPatched = true;
}
