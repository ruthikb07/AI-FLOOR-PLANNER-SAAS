/**
 * Probe Cloudflare Workers AI FLUX models (multipart, no references).
 * Reports HTTP status + latency per model. Never prints credentials.
 * Usage: node scripts/probe-cf-flux-models.mjs [model ...]
 */
import fs from 'node:fs';
import path from 'node:path';

const envFile = path.resolve('packages/backend/.env');
const env = Object.fromEntries(
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const account = env.CLOUDFLARE_ACCOUNT_ID;
const token = env.CLOUDFLARE_API_TOKEN;
if (!account || !token) {
  console.error('CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN missing');
  process.exit(1);
}
const models = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : ['@cf/black-forest-labs/flux-2-klein-4b', '@cf/black-forest-labs/flux-2-klein-9b'];

for (const model of models) {
  const form = new FormData();
  form.append('prompt', 'Clean 2D architectural floor plan, black lines on white, top-down.');
  form.append('width', '512');
  form.append('height', '512');
  form.append('seed', '42');
  const t0 = Date.now();
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    console.log(`${model}: HTTP ${res.status} in ${Date.now() - t0} ms (${text.length} bytes${res.ok ? '' : `: ${text.slice(0, 160)}`})`);
  } catch (err) {
    console.log(`${model}: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)} after ${Date.now() - t0} ms`);
  }
}
