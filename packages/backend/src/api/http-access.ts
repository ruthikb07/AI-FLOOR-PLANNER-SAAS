import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const localOrigins = new Set(
  ['localhost', '127.0.0.1', '[::1]'].flatMap(host =>
    [3000, 4173, 4177, 5173].map(port => `http://${host}:${port}`)),
);
const exposedHeaders = 'Content-Disposition, Content-Length, X-CAD-Format, X-CAD-Magic, X-CAD-Entities, X-CAD-Layers, X-CAD-Validation, X-CAD-Pages, X-CAD-Disk-Path, X-CAD-Download-URL, X-Artifact-Descriptor, X-ETABS-Format';

export function isLoopbackHost(host: string): boolean {
  return localHosts.has(host);
}

export interface ApiAccess {
  readonly token?: string;
  readonly origins: ReadonlySet<string>;
  readonly etabsOrigins: ReadonlySet<string>;
}

export function resolveApiAccess(env: NodeJS.ProcessEnv = process.env): ApiAccess {
  const token = env.RH_API_TOKEN?.trim() || undefined;
  if (token && (token.length < 32 || !/^[\x21-\x7e]+$/.test(token))) {
    throw new Error('RH_API_TOKEN must contain at least 32 printable non-space characters.');
  }
  const origins = (value: string | undefined) => new Set(value?.split(',').map(entry => entry.trim()).filter(Boolean).map(origin => {
    const url = new URL(origin);
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) {
      throw new Error('API allowed origins must be exact HTTP(S) origins.');
    }
    return origin;
  }));
  return {
    token,
    origins: origins(env.RH_API_ALLOWED_ORIGINS),
    etabsOrigins: origins(env.RH_ETABS_ALLOWED_ORIGINS),
  };
}

function requestHost(request: IncomingMessage): URL | undefined {
  const host = request.headers.host;
  if (!host || !/^(?:[a-z0-9.-]+|\[[\da-f:]+\])(?::\d+)?$/i.test(host)) return undefined;
  try { return new URL(`http://${host}`); } catch { return undefined; }
}

export function authorizeApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  access: ApiAccess,
): { status: number; code: string; message: string } | undefined {
  response.setHeader('Vary', 'Origin');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');

  const origin = request.headers.origin;
  const host = requestHost(request);
  const nativeEtabs = /^\/api(?:\/v1)?\/export\/etabs(?:\/download\/[^/]+)?$/.test(pathname);
  const allowedOrigin = origin && (access.origins.has(origin) || localOrigins.has(origin)
    || (nativeEtabs && access.etabsOrigins.has(origin))
    || (host && isLoopbackHost(host.hostname) && origin === host.origin));
  if (origin && !allowedOrigin) {
    return { status: 403, code: 'ORIGIN_DENIED', message: 'This origin is not allowed to access the studio API.' };
  }
  if (allowedOrigin) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.setHeader('Access-Control-Expose-Headers', exposedHeaders);
  }
  if (request.method === 'OPTIONS') return;

  const fromLoopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')
    && host && isLoopbackHost(host.hostname);
  if (access.token && !nativeEtabs) {
    const expected = Buffer.from(`Bearer ${access.token}`);
    const supplied = Buffer.from(request.headers.authorization ?? '');
    if (supplied.length === expected.length && timingSafeEqual(supplied, expected)) return;
    response.setHeader('WWW-Authenticate', 'Bearer');
    return { status: 401, code: 'UNAUTHORIZED', message: 'Studio API authorization is required.' };
  }

  // The native route also requires its own ETABS bearer token.
  const trustedBrowser = origin ? (nativeEtabs || localOrigins.has(origin) || origin === host?.origin
    || (access.origins.has(origin) && isLoopbackHost(new URL(origin).hostname)))
    : !['cross-site', 'same-site'].includes(request.headers['sec-fetch-site'] ?? '');
  if (fromLoopback && trustedBrowser) return;
  return { status: 403, code: 'LOCAL_ONLY', message: 'This operation requires a trusted local studio connection.' };
}
