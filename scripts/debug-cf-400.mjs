import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve('packages/backend/.env');
const lines = fs.readFileSync(envPath, 'utf8').split('\n');
for (const line of lines) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-2-klein-4b`;

async function debugCall() {
  const refDir = path.resolve('packages/backend/data/reference-images/normalized_512');
  const files = fs.readdirSync(refDir).filter(f => f.endsWith('.png')).sort();
  
  const form = new FormData();
  form.append('prompt', '2D floor plan');
  form.append('steps', '4');
  form.append('seed', '54321');
  form.append('negative_prompt', '3D, render');
  form.append('width', '1024');
  form.append('height', '1024');

  for (let i = 0; i < files.length; i++) {
    const buf = fs.readFileSync(path.join(refDir, files[i]));
    form.append(`input_image_${i}`, new Blob([buf], { type: 'image/png' }), `ref_${i}.png`);
  }

  const svg = `<svg width="500" height="500" xmlns="http://www.w3.org/2000/svg"><rect width="500" height="500" fill="white"/></svg>`;
  form.append('input_image_3', new Blob([Buffer.from(svg)], { type: 'image/svg+xml' }), 'schematic.svg');

  console.log('Sending multipart request with 3 PNGs + 1 SVG...');
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiToken}` },
    body: form,
  });

  console.log(`Status: ${res.status} ${res.statusText}`);
  const text = await res.text();
  console.log('Response body:', text);
}

debugCall();
