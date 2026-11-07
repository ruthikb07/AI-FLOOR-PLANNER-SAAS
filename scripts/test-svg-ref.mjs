import fs from 'node:fs';
import path from 'node:path';

// Load .env
const envPath = path.resolve('packages/backend/.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const model = process.env.CLOUDFLARE_FLUX_MODEL || '@cf/black-forest-labs/flux-2-klein-4b';
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model.replace(/^\/+/, '')}`;

const testSvg = `<svg width="500" height="500" xmlns="http://www.w3.org/2000/svg">
  <rect width="500" height="500" fill="white"/>
  <rect x="50" y="50" width="180" height="400" fill="#e0f2fe" stroke="black"/>
  <rect x="270" y="50" width="180" height="400" fill="#fef3c7" stroke="black"/>
  <text x="140" y="250" text-anchor="middle" font-family="sans-serif" font-size="20">FLAT 01 (2BHK)</text>
  <text x="360" y="250" text-anchor="middle" font-family="sans-serif" font-size="20">FLAT 02 (3BHK)</text>
</svg>`;

async function testSvgReference() {
  console.log('Testing SVG blob as input_image_3 in Cloudflare...');
  const form = new FormData();
  form.append('prompt', '2D floor plan layout');
  form.append('width', '512');
  form.append('height', '512');
  form.append('seed', '42');

  const refPath = path.resolve('packages/backend/data/reference-images/normalized_512/ref_apartment_01_multi_unit_typical.png');
  const pngBytes = fs.readFileSync(refPath);

  form.append('input_image_0', new Blob([pngBytes], { type: 'image/png' }), 'ref_0.png');
  form.append('input_image_3', new Blob([Buffer.from(testSvg)], { type: 'image/svg+xml' }), 'schematic.svg');

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiToken}` },
      body: form,
      signal: AbortSignal.timeout(30000),
    });
    console.log(`SVG test status: ${res.status} ${res.statusText}`);
    const text = await res.text();
    console.log(`Response:`, text.slice(0, 200));
  } catch (err) {
    console.error('Fetch error:', err);
  }
}

testSvgReference();
