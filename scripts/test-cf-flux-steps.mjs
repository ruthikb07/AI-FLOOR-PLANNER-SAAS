import fs from 'node:fs';
import path from 'node:path';

// Load .env
const envPath = path.resolve('packages/backend/.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      process.env[match[1].trim()] = match[2].trim();
    }
  }
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const model = process.env.CLOUDFLARE_FLUX_MODEL || '@cf/black-forest-labs/flux-2-klein-4b';

console.log('Testing Cloudflare FLUX transport directly...');
console.log('Account ID present:', Boolean(accountId), accountId ? accountId.slice(0, 6) + '...' : '');
console.log('Token present:', Boolean(apiToken));
console.log('Model:', model);

const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model.replace(/^\/+/, '')}`;

async function testPromptOnly() {
  console.log('\n--- 1. MINIMUM FLUX TEST (Prompt-only, no references) ---');
  const form = new FormData();
  form.append('prompt', '2D architectural floor plan of a small apartment, clean technical drawing');
  form.append('width', '1024');
  form.append('height', '1024');
  form.append('seed', '42');

  const start = Date.now();
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Accept': 'image/png, application/json',
      },
      body: form,
      signal: AbortSignal.timeout(60000),
    });

    const elapsed = Date.now() - start;
    console.log(`Status: ${res.status} ${res.statusText} (${elapsed}ms)`);
    console.log(`Content-Type: ${res.headers.get('content-type')}`);

    if (res.ok) {
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.startsWith('image/')) {
        const buf = Buffer.from(await res.arrayBuffer());
        console.log(`Success: Received ${buf.length} bytes of image data.`);
      } else {
        const json = await res.json();
        console.log('Success: Received JSON response:', JSON.stringify(json).slice(0, 200));
      }
      return true;
    } else {
      const errText = await res.text();
      console.error(`Cloudflare error (HTTP ${res.status}):`, errText);
      return false;
    }
  } catch (err) {
    console.error('Fetch error:', err);
    return false;
  }
}

async function testOneReference() {
  console.log('\n--- 2. ONE REFERENCE IMAGE TEST (input_image_0) ---');
  const refPath = path.resolve('packages/backend/data/reference-images/normalized_512/ref_apartment_01_multi_unit_typical.png');
  if (!fs.existsSync(refPath)) {
    console.error('REFERENCE_FILE_READ_ERROR: File does not exist:', refPath);
    return false;
  }
  const fileBytes = fs.readFileSync(refPath);
  console.log(`Loaded reference file: ${refPath} (${fileBytes.length} bytes)`);

  const form = new FormData();
  form.append('prompt', '2D architectural floor plan of an apartment inspired by the reference, clean technical lines');
  form.append('width', '1024');
  form.append('height', '1024');
  form.append('seed', '42');

  const blob = new Blob([fileBytes], { type: 'image/png' });
  form.append('input_image_0', blob, 'ref_0.png');

  const start = Date.now();
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Accept': 'image/png, application/json',
      },
      body: form,
      signal: AbortSignal.timeout(60000),
    });

    const elapsed = Date.now() - start;
    console.log(`Status: ${res.status} ${res.statusText} (${elapsed}ms)`);
    console.log(`Content-Type: ${res.headers.get('content-type')}`);

    if (res.ok) {
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.startsWith('image/')) {
        const buf = Buffer.from(await res.arrayBuffer());
        console.log(`Success: Received ${buf.length} bytes of image data with 1 reference.`);
      } else {
        const json = await res.json();
        console.log('Success: Received JSON response:', JSON.stringify(json).slice(0, 200));
      }
      return true;
    } else {
      const errText = await res.text();
      console.error(`Cloudflare error (HTTP ${res.status}):`, errText);
      return false;
    }
  } catch (err) {
    console.error('Fetch error:', err);
    return false;
  }
}

async function testFourReferences() {
  console.log('\n--- 3. FOUR REFERENCE IMAGES TEST (input_image_0..3) ---');
  const refDir = path.resolve('packages/backend/data/reference-images/normalized_512');
  const files = fs.readdirSync(refDir).filter(f => f.endsWith('.png'));
  console.log(`Found ${files.length} reference files in ${refDir}`);

  const form = new FormData();
  form.append('prompt', '2D architectural floor plan of an apartment, technical drafting');
  form.append('width', '1024');
  form.append('height', '1024');
  form.append('seed', '42');

  // We need 4 references: 3 supplied + 1 synthetic/schematic
  const refBuffers = files.map(f => fs.readFileSync(path.join(refDir, f)));
  // If only 3, duplicate the first or use a 4th dummy image
  while (refBuffers.length < 4) {
    refBuffers.push(refBuffers[0]);
  }

  for (let i = 0; i < 4; i++) {
    const blob = new Blob([refBuffers[i]], { type: 'image/png' });
    form.append(`input_image_${i}`, blob, `ref_${i}.png`);
  }

  const start = Date.now();
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Accept': 'image/png, application/json',
      },
      body: form,
      signal: AbortSignal.timeout(60000),
    });

    const elapsed = Date.now() - start;
    console.log(`Status: ${res.status} ${res.statusText} (${elapsed}ms)`);
    console.log(`Content-Type: ${res.headers.get('content-type')}`);

    if (res.ok) {
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.startsWith('image/')) {
        const buf = Buffer.from(await res.arrayBuffer());
        console.log(`Success: Received ${buf.length} bytes of image data with 4 references.`);
      } else {
        const json = await res.json();
        console.log('Success: Received JSON response:', JSON.stringify(json).slice(0, 200));
      }
      return true;
    } else {
      const errText = await res.text();
      console.error(`Cloudflare error (HTTP ${res.status}):`, errText);
      return false;
    }
  } catch (err) {
    console.error('Fetch error:', err);
    return false;
  }
}

async function main() {
  const pOnly = await testPromptOnly();
  if (!pOnly) {
    console.error('\nFAILED at step 1: Prompt-only test failed.');
    process.exit(1);
  }
  const oneRef = await testOneReference();
  if (!oneRef) {
    console.error('\nFAILED at step 2: One-reference test failed.');
    process.exit(1);
  }
  const fourRef = await testFourReferences();
  if (!fourRef) {
    console.error('\nFAILED at step 3: Four-reference test failed.');
    process.exit(1);
  }
  console.log('\nALL 3 FLUX TRANSPORT TESTS PASSED!');
}

main();
