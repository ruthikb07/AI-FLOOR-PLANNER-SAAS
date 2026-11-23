import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createBackendServer } from '../server.js';

describe('HTTP trust boundary', () => {
  const server = createBackendServer({ gemini: null, briefInterpreterKind: 'gemini' });
  let base: string;
  beforeAll(async () => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

  it.each([
    ['/api/v1/local-projects', 'GET'],
    ['/api/v1/export/download/example.dxf', 'GET'],
    ['/api/v1/import/cad-layout/capabilities', 'GET'],
    ['/api/v1/architecture/evaluate', 'POST'],
    ['/api/projects/generate', 'POST'],
    ['/api/v1/export/etabs/e2k', 'POST'],
  ])('denies foreign browser origins on %s', async (path, method) => {
    const response = await fetch(base + path, { method, headers: { Origin: 'https://untrusted.example' } });
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects a noncanonical project payload before entering the store', async () => {
    const response = await fetch(base + '/api/v1/local-projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ building: { floors: [] }, projectId: 'repair-invalid-test' }),
    });
    expect(response.status).toBe(400);
  });

  it('rejects a revision with trailing characters', async () => {
    expect((await fetch(base + '/api/v1/local-projects/repair-absent?revision=1x')).status).toBe(400);
  });

  it('allows the loopback studio origin and scopes the preflight response', async () => {
    const origin = 'http://localhost:3000';
    const response = await fetch(base + '/api/v1/local-projects', { method: 'OPTIONS', headers: { Origin: origin } });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect(response.headers.get('vary')).toBe('Origin');
    expect((await fetch(base + '/api/v1/local-projects', { headers: { Origin: origin } })).status).toBe(200);
  });

  it('requires a loopback Host as well as a loopback TCP peer in local mode', async () => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      request(base + '/api/v1/local-projects', { headers: { Host: 'untrusted.example' } }, response => {
        response.resume();
        resolve(response.statusCode);
      }).on('error', reject).end();
    });
    expect(status).toBe(403);
  });

  it.each([
    ['/api/v1/local-projects', JSON.stringify({ building: { floors: [] } }), 'text/plain', 415],
    ['/api/v1/import/cad-layout', JSON.stringify(null), 'application/json', 400],
    ['/api/v1/export/artifacts', JSON.stringify({ format: 'pdf', building: {} }), 'application/json', 400],
    ['/api/v1/projects/generate', JSON.stringify({ config: { plotWidthMm: '12000', plotDepthMm: 12000 } }), 'application/json', 400],
  ])('rejects invalid inputs for %s', async (path, body, contentType, status) => {
    const response = await fetch(base + path, { method: 'POST', body, headers: { 'Content-Type': contentType } });
    expect(response.status).toBe(status);
  });

  it('requires the configured bearer token even for requests from a loopback proxy', async () => {
    const origin = 'https://studio.example';
    const token = randomBytes(32).toString('hex');
    const secured = createBackendServer({
      gemini: null, briefInterpreterKind: 'gemini',
      apiAccess: { token, origins: new Set([origin]), etabsOrigins: new Set() },
    });
    await new Promise<void>(resolve => secured.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(secured.address() as AddressInfo).port}/api/v1/local-projects`;
    try {
      expect((await fetch(url)).status).toBe(401);
      expect((await fetch(url, { headers: { Origin: origin, Authorization: 'Bearer wrong' } })).status).toBe(401);
      const accepted = await fetch(url, { headers: { Origin: origin, Authorization: `Bearer ${token}` } });
      expect(accepted.status).toBe(200);
      expect(accepted.headers.get('access-control-allow-origin')).toBe(origin);
      expect(accepted.headers.get('cache-control')).toBe('no-store');
    } finally {
      await new Promise<void>(resolve => secured.close(() => resolve()));
    }
  });
});
