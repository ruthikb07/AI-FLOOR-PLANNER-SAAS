import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactDir = resolve(frontend, '../../test-artifacts/hero-phase-c');
const base = process.env.RH_SHOWCASE_URL ?? 'http://127.0.0.1:4197';
const dist = process.env.RH_SHOWCASE_DIST;
const chrome = process.env.RH_SHOWCASE_CHROME ?? 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const reference = join(frontend, 'public/hero-refs/raheja-vivarea-aerial.jpg');
const publishedModelView = join(frontend, 'public/architecture/mumbai-reference-view.jpg');
const errors = [];
const allowedLabel = 'Demonstration model, inspired by Mumbai luxury residential';
await mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: chrome,
  args: ['--use-angle=d3d11', '--disable-background-timer-throttling'],
});

try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  const chunks = new Set();
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    const url = new URL(response.url());
    if (response.ok() && response.request().resourceType() === 'script' &&
        url.origin === new URL(base).origin && url.pathname.endsWith('.js')) chunks.add(url.pathname);
  });
  page.on('console', message => {
    if (message.type() === 'error' && /THREE|showcase model|Welcome model/i.test(message.text())) errors.push(message.text());
  });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  const host = page.getByTestId('residence-showcase');
  await page.waitForFunction(() => ['ready', 'unavailable'].includes(document.querySelector('[data-testid=residence-showcase]')?.getAttribute('data-status')), null, { timeout: 90000 });
  assert.equal(await host.getAttribute('data-status'), 'ready', errors.join('\n'));
  await page.evaluate(() => document.fonts.ready);
  assert(await page.getByText(allowedLabel, { exact: true }).first().isVisible());
  assert(!await page.locator('.rh-atelier-viewport').getByText(/Raheja Vivarea/i).count());
  assert(!await page.getByRole('button', { name: 'Section', exact: true }).count());

  const payload = [];
  if (dist) {
    for (const url of chunks) {
      const bytes = await readFile(resolve(dist, '.' + url));
      payload.push({ path: url, rawBytes: bytes.length, gzipBytes: gzipSync(bytes).length });
    }
  }
  const measured = [];
  for (const [button, progress, filename, night] of [
    ['Exterior', '0.000', '02-three-quarter.jpg', false],
    ['Street', '0.250', '01-street.jpg', false],
    ['Elevated', '0.500', '03-elevated.jpg', false],
    ['Facade', '0.750', '04-facade-close.jpg', false],
    ['Arrival', '1.000', '05-dusk.jpg', true],
  ]) {
    await page.getByRole('button', { name: button, exact: true }).click();
    if (night) await page.getByRole('button', { name: 'Switch to evening' }).click();
    await page.waitForFunction(({ progress, light }) => {
      const node = document.querySelector('[data-testid=residence-showcase]');
      return node?.dataset.progress === progress && node?.dataset.lightProgress === light;
    }, { progress, light: night ? '1.000' : '0.000' });
    const counts = await host.evaluate(el => ({
      view: el.parentElement.dataset.view, gpu: el.dataset.gpu,
      drawCalls: Number(el.dataset.drawCalls), triangles: Number(el.dataset.triangles),
      components: Number(el.dataset.componentCount),
    }));
    assert(counts.drawCalls > 0 && counts.triangles > 0 && counts.components > 100);
    measured.push(counts);
    if (button === 'Exterior') await page.screenshot({ path: join(artifactDir, '00-welcome.jpg'), type: 'jpeg', quality: 93 });
    const style = await page.addStyleTag({ content: `
      .rh-atelier-top, .rh-atelier-scrim, .rh-atelier-story,
      .rh-atelier-controls, .rh-atelier-chapters { display: none !important }
    ` });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: join(artifactDir, filename), type: 'jpeg', quality: 94, animations: 'disabled' });
    await style.evaluate(node => node.remove());
  }

  const referenceAvailable = await stat(reference).then(item => item.isFile(), () => false);
  if (process.env.RH_SHOWCASE_UPDATE_REFERENCE === '1') {
    await copyFile(join(artifactDir, '03-elevated.jpg'), publishedModelView);
  }
  const referenceView = await stat(publishedModelView).then(item => item.isFile(), () => false);
  if (referenceView) {
    await page.route('**/architecture/mumbai-reference-view.jpg*', route =>
      route.fulfill({ path: publishedModelView, contentType: 'image/jpeg' }));
    if (referenceAvailable) {
      await page.route('**/hero-refs/raheja-vivarea-aerial.jpg', route =>
        route.fulfill({ path: reference, contentType: 'image/jpeg' }));
    }
    await page.getByRole('link', { name: 'References & credits' }).click();
    const comparison = page.locator('.rh-atelier-comparison');
    const photo = referenceAvailable
      ? comparison.getByRole('img', { name: /Aerial photograph of Raheja Vivarea/ })
      : comparison.getByRole('link', { name: 'View the aerial photograph on Wikimedia Commons ↗' });
    await photo.waitFor({ state: 'visible' });
    const model = comparison.getByRole('img', { name: /Elevated view of the demonstration/ });
    await model.evaluate((image, timestamp) => {
      image.loading = 'eager';
      image.src += '?capture=' + timestamp;
      return image.decode();
    }, Date.now());
    if (referenceAvailable) await photo.evaluate(image => image.decode());
    await comparison.screenshot({ path: join(artifactDir, '06-reference-comparison.jpg'), type: 'jpeg', quality: 93 });
  }
  assert.deepEqual(errors, []);
  const glb = await stat(join(frontend, 'public/architecture/mumbai-residential.glb'));
  const report = {
    chrome: browser.version(), viewport: '1280 × 800 DPR 1', glbBytes: glb.size,
    referenceAvailable, firstLoadJs: payload,
    firstLoadGzipBytes: dist ? payload.reduce((total, item) => total + item.gzipBytes, 0) : null,
    measured, errors,
  };
  await writeFile(join(artifactDir, 'metrics.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
