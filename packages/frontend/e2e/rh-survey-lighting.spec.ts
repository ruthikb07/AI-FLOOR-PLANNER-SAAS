import { chromium, expect, test, type Page } from '@playwright/test';

const url = process.env.RH_CINEMATIC_URL ?? 'http://127.0.0.1:4177';
test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } });

async function openSurvey(page: Page) {
  await page.addInitScript(() => sessionStorage.setItem('rh_welcome_dismissed', 'true'));
  await page.goto(url);
  await page.getByRole('button', { name: 'Surveyed boundary' }).click();
  await page.getByLabel('Starting outline').selectOption('curve');
}

test.describe('WebGL survey preview', () => {
  test('orbit, draft edits, presets and sun heading change the rendered site', async ({ page }, info) => {
    test.setTimeout(80_000);
    await page.setViewportSize({ width: 1440, height: 1024 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await openSurvey(page);
    await page.getByRole('button', { name: '3D site' }).click();
    const preview = page.getByTestId('survey-site-preview');
    const canvas = preview.getByRole('img', { name: 'Interactive survey site model' });
    await expect(preview).toHaveAttribute('data-status', 'ready', { timeout: 25_000 });
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;
    const captureSite = () => page.screenshot({
      clip: { x: box.x, y: box.y + 48, width: box.width, height: box.height - 92 },
    });
    const initialView = await captureSite();
    await page.getByTestId('survey-drawing').screenshot({ path: info.outputPath('survey-daylight.png') });

    await page.mouse.move(box.x + box.width * .57, box.y + box.height * .55);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .44, box.y + box.height * .61, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await captureSite()).equals(initialView)).toBe(false);
    await page.getByRole('button', { name: 'Reset site camera' }).click();
    await expect.poll(async () => (await captureSite()).equals(initialView)).toBe(true);

    await page.getByRole('button', { name: 'Dusk' }).click();
    await expect(preview).toHaveAttribute('data-lighting', 'dusk');
    await expect.poll(async () => (await captureSite()).equals(initialView)).toBe(false);
    const dusk = await captureSite();
    await page.getByRole('slider', { name: 'Sun direction' }).press('Home');
    await expect(page.getByRole('slider', { name: 'Sun direction' })).toHaveValue('0');
    await expect.poll(async () => (await captureSite()).equals(dusk)).toBe(false);
    await page.getByTestId('survey-drawing').screenshot({ path: info.outputPath('survey-dusk.png') });

    const curve = await captureSite();
    await page.getByLabel('Signed sweep (°)').fill('115');
    await page.getByRole('button', { name: '3D site' }).scrollIntoViewIfNeeded();
    await expect.poll(async () => (await captureSite()).equals(curve)).toBe(false);
    await page.getByRole('button', { name: 'Plan', exact: true }).click();
    await expect(page.getByTestId('survey-arc')).toBeVisible();
    await expect(page.getByLabel('Signed sweep (°)')).toHaveValue('115');
    expect(errors).toEqual([]);
  });
});

test('3D fallback returns to the editable plan on a mobile viewport', async () => {
  const browser = await chromium.launch({ args: ['--disable-webgl'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await openSurvey(page);
    await page.getByRole('button', { name: '3D site' }).click();
    await expect(page.getByText('3D rendering is unavailable on this device.')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Return to plan' }).click();
    await expect(page.getByTestId('survey-arc')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  } finally {
    await browser.close();
  }
});
