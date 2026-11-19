import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const base = process.env.RH_CINEMATIC_URL ?? 'http://127.0.0.1:4177';
const chrome = process.env.RH_CINEMATIC_CHROME;
test.use({
  launchOptions: chrome
    ? { executablePath: chrome, args: ['--use-angle=d3d11'] }
    : { args: ['--enable-unsafe-swiftshader'] },
});

function surveyPdf() {
  const drawing = '0.2 0.2 0.2 RG 1 w 60 100 240 320 re S BT /F1 12 Tf 64 430 Td (Survey plot - 30 m x 40 m) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${drawing.length} >>\nstream\n${drawing}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let file = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = file.length;
    file += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = file.length;
  file += `xref\n0 6\n0000000000 65535 f \n${offsets.map(value => `${String(value).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(file);
}


test('welcome renders one scene and scrubs forward and back', async ({ page }, info) => {
  test.setTimeout(105_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    const metrics = { lcp: 0, cls: 0 };
    Object.assign(window, { rhBrowserMetrics: metrics });
    new PerformanceObserver(list => {
      for (const item of list.getEntries()) metrics.lcp = item.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(list => {
      for (const item of list.getEntries() as Array<PerformanceEntry & { hadRecentInput: boolean; value: number }>) {
        if (!item.hadRecentInput) metrics.cls += item.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  const scene = page.getByTestId('residence-showcase');
  const canvas = scene.locator('canvas');
  await expect(scene).toHaveAttribute('data-status', 'ready', { timeout: 45_000 });
  await expect(scene).toHaveAttribute('data-neighborhood-count', '8');
  await expect(scene).toHaveAttribute('data-component-count', /^\d{3}$/);
  await expect(page.getByText('Demonstration model, inspired by Mumbai luxury residential', { exact: true }).first()).toBeVisible();
  await expect(canvas).toBeVisible();
  const original = await canvas.elementHandle();
  await page.screenshot({ path: info.outputPath('01-welcome.png') });
  const metrics = await page.evaluate(() => (window as Window & { rhBrowserMetrics?: object }).rhBrowserMetrics);
  console.log('Welcome browser metrics', { gpu: await scene.getAttribute('data-gpu'), metrics });

  await page.getByTestId('cta-explore-scroll').click();
  const views = page.getByRole('navigation', { name: 'Architectural views' });
  const street = views.getByRole('button', { name: 'Street', exact: true });
  await expect(street).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  await expect.poll(async () => Number(await scene.getAttribute('data-progress')), { timeout: 10_000 }).toBeGreaterThan(.22);
  await page.screenshot({ path: info.outputPath('01b-streetscape-daylight.png') });
  await page.mouse.move(850, 395);
  await page.mouse.wheel(0, 570);
  const elevated = views.getByRole('button', { name: 'Elevated', exact: true });
  await expect(elevated).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  await expect.poll(async () => Number(await scene.getAttribute('data-progress'))).toBeGreaterThan(.43);
  await page.screenshot({ path: info.outputPath('02-elevated.png') });

  await page.mouse.wheel(0, -550);
  await expect(street).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  await expect.poll(async () => Number(await scene.getAttribute('data-progress'))).toBeLessThan(.33);
  await views.getByRole('button', { name: 'Arrival', exact: true }).click();
  await expect(views.getByRole('button', { name: 'Arrival', exact: true })).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  await expect.poll(async () => Number(await scene.getAttribute('data-progress')), { timeout: 10_000 }).toBeGreaterThan(.88);
  await page.screenshot({ path: info.outputPath('02b-arrival.png') });
  expect(await canvas.evaluate((node, previous) => node === previous, original)).toBe(true);

  await page.getByRole('button', { name: 'Orbit model' }).click();
  const orbit = page.getByRole('button', { name: 'Resume tour' });
  await expect(orbit).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(830, 400);
  await page.mouse.down();
  await page.mouse.move(950, 430);
  await page.mouse.up();
  await page.getByTestId('welcome-theme-toggle').click();
  await expect(page.getByTestId('welcome-theme-toggle')).toHaveAccessibleName('Switch to daylight');
  await expect.poll(async () => Number(await scene.getAttribute('data-light-progress')), { timeout: 12_000 }).toBeGreaterThan(.99);
  await page.getByRole('button', { name: 'Resume tour' }).click();
  await street.click();
  await expect(street).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Number(await scene.getAttribute('data-progress'))).toBeCloseTo(.25, 2);
  await page.screenshot({ path: info.outputPath('02e-streetscape-evening.png') });

  const gallery = page.getByRole('region', { name: 'References & credits' });
  await page.getByRole('link', { name: 'References & credits' }).click();
  await gallery.scrollIntoViewIfNeeded();
  await gallery.getByRole('img', { name: /Elevated view of the demonstration/ })
    .evaluate(image => (image as HTMLImageElement).decode());
  await expect(gallery.getByRole('link', { name: 'CC BY 4.0' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/');
  await gallery.screenshot({ path: info.outputPath('02c-references-and-credits.png') });
  await gallery.getByRole('link', { name: 'Back to showcase' }).click();
  await page.getByRole('heading', { name: 'How are you building?' }).scrollIntoViewIfNeeded();
  await page.locator('.rh-atelier-choices').screenshot({ path: info.outputPath('02d-project-entry.png') });
  expect(errors).toEqual([]);
  await page.getByTestId('cta-new-construction').click();
  await expect(canvas).toHaveCount(0);
});

test('mobile landing, project entry and redevelopment allocations', async ({ page }, info) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(base);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.getByTestId('welcome-scroll-container').evaluate(node => node.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath('03-mobile-welcome.png') });
  await page.getByTestId('cta-redevelopment').click();
  await expect(page.getByTestId('redevelopment-program-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Existing', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Existing', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Proposed', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Duplex count' }).fill('1');
  await page.getByRole('spinbutton', { name: 'Triplex count' }).fill('1');
  await expect(page.getByTestId('redevelopment-feasibility-card')).toBeVisible();
  await page.getByTestId('redevelopment-program-panel').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('04-redevelopment.png') });
  await page.getByRole('button', { name: 'Continue to Step 02' }).click();
  await expect(page.getByRole('heading', { name: 'Floors and parking' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('04b-mobile-floors.png') });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Duplex count' })).toHaveValue('1');
  await expect(page.getByRole('spinbutton', { name: 'Triplex count' })).toHaveValue('1');
  await page.getByTestId('nav-welcome-home').click();
  await page.getByTestId('cta-open-existing').click();
  await expect(page.getByRole('heading', { name: 'Project library' })).toBeVisible();
  await expect(page.getByTestId('btn-new-project-from-switcher')).toBeVisible();
});

test('welcome keeps project entry usable when WebGL is unavailable', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind: string, ...options: unknown[]) {
      return kind.startsWith('webgl') ? null : Reflect.apply(getContext, this, [kind, ...options]);
    } as typeof getContext;
  });
  await page.goto(base);
  await expect(page.getByTestId('residence-showcase')).toHaveAttribute('data-status', 'unavailable');
  await expect(page.getByText('Reference photograph · 3D unavailable')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Orbit model' })).toBeHidden();
  await page.locator('.rh-atelier-fallback').evaluate((photo: HTMLImageElement) => photo.decode());
  await page.screenshot({ path: info.outputPath('03b-mobile-webgl-fallback.png') });
  await page.getByRole('button', { name: 'Start a project' }).click();
  await page.getByTestId('cta-new-construction').click();
  await expect(page.getByRole('heading', { name: 'Project type and site' })).toBeVisible();
});

test('production generation, PDF, CAD editing, 3D and verified downloads', async ({ page }, info) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  const failedRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400 && response.url().startsWith(base)) {
      failedRequests.push(`${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
  await page.goto(base);
  await page.getByTestId('cta-new-construction').click();
  await page.getByLabel('Project Title / Estate', { exact: false }).fill('RH Browser Acceptance');
  const plot = page.getByTestId('parcel-study');
  const drawing = plot.getByRole('img', { name: /Schematic/ });
  const frontage = page.getByLabel('Frontage (Width W)', { exact: false });
  const originalFrontage = await frontage.inputValue();
  await frontage.fill('33');
  await expect(drawing).toHaveAccessibleName(/Schematic 33 by/);
  const shape = plot.locator('polygon').first();
  const points = await shape.getAttribute('points');
  await plot.getByRole('button', { name: 'Rotate plot right' }).click();
  await expect(shape).not.toHaveAttribute('points', points!);
  await frontage.fill(originalFrontage);
  await page.screenshot({ path: info.outputPath('05-project-setup.png') });
  for (const step of [2, 3, 4]) {
    await page.getByRole('button', { name: `Continue to Step 0${step}` }).click();
    if (step !== 4) await page.screenshot({ path: info.outputPath(`05-setup-step-${step}.png`) });
  }
  const prompt = page.getByPlaceholder('Describe room layout preferences', { exact: false });
  await prompt.fill('Prioritize natural light in the living rooms and separate private bedrooms from entry circulation.');
  const fileInput = page.locator('input[type=file]').first();
  await fileInput.setInputFiles({ name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('invalid') });
  await expect(page.getByText('The selected file does not have a valid PDF signature.')).toBeVisible();
  await fileInput.setInputFiles({ name: 'survey.pdf', mimeType: 'application/pdf', buffer: surveyPdf() });
  await expect(page.getByTitle('Reference PDF page preview')).toBeAttached();
  await expect(page.getByTestId('pdf-conversion-disclaimer')).toContainText('Drawing recognition and model reconstruction require manual input.');
  await page.getByTestId('checkbox-reference-verified').check();
  await page.getByRole('heading', { name: 'Project brief and references' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('06-brief.png') });
  await page.getByTitle('Reference PDF page preview').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('06b-pdf.png') });
  const generation = page.waitForRequest(request => request.url().endsWith('/api/v1/projects/generate'), { timeout: 30_000 });
  await page.getByRole('button', { name: 'Generate Architectural Project' }).click();
  await expect(page.getByRole('dialog', { name: 'Generating your building' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('07-generation.png') });
  expect((await generation).method()).toBe('POST');
  const concepts = page.getByRole('region', { name: 'Concept gallery' });
  await expect(concepts.getByRole('heading', { name: 'Design studies' })).toBeVisible({ timeout: 115_000 });
  await expect(concepts.getByRole('img', { name: /Plan preview/ }).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('07b-concepts.png') });
  await concepts.getByRole('button', { name: 'Building', exact: true }).click();
  await expect(concepts.locator('canvas')).toBeVisible({ timeout: 25_000 });
  await page.screenshot({ path: info.outputPath('07c-concept-model.png') });
  await concepts.getByRole('button', { name: 'Plan', exact: true }).click();
  const alternate = page.waitForRequest(request => request.url().endsWith('/api/v1/projects/generate'), { timeout: 30_000 });
  await concepts.getByRole('button', { name: 'Generate another concept' }).click();
  expect((await alternate).method()).toBe('POST');
  await expect(page.getByRole('dialog', { name: 'Generating your building' })).toBeHidden({ timeout: 115_000 });
  const second = concepts.getByRole('button', { name: /Concept 2/ });
  await expect(second).toBeVisible();
  await second.click();
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: info.outputPath('07d-alternatives.png') });
  await concepts.getByRole('button', { name: 'Open in CAD' }).click();
  await expect(page.getByText('Layout score', { exact: false }).first()).toBeVisible({ timeout: 115_000 });
  await page.screenshot({ path: info.outputPath('08-cad.png') });
  await page.getByRole('button', { name: 'Hide inspector' }).click();
  await expect(page.getByRole('complementary', { name: 'Drawing inspector' })).toBeHidden();
  await page.getByRole('button', { name: 'Show inspector' }).click();
  await expect(page.getByRole('complementary', { name: 'Drawing inspector' })).toBeVisible();
  await page.getByTestId('nav-edit_plan').click();
  await expect(page.getByTestId('edit-plan-drag-handles')).toBeVisible();
  const width = page.locator('label:has-text("Width (mm)") input');
  const initial = await width.inputValue();
  await page.getByRole('button', { name: '+300mm Out' }).click();
  const rejection = page.getByRole('region', { name: 'Interactive Plan Editor Studio' }).getByRole('alert');
  const undo = page.getByTestId('edit-plan-undo');
  if (await rejection.isVisible()) {
    await expect(rejection).not.toBeEmpty();
    await expect(width).toHaveValue(initial);
  } else {
    await expect(undo).toBeEnabled();
    await expect(width).not.toHaveValue(initial);
    await undo.click();
    await expect(width).toHaveValue(initial);
  }
  await page.screenshot({ path: info.outputPath('08b-plan-editor.png') });
  await page.getByRole('button', { name: 'Design assistant' }).click();
  await expect(page.getByRole('complementary', { name: 'RH Planner AI Assistant' })).toContainText('Revision');
  await page.getByLabel('Review request').fill('Review circulation for the selected floor.');
  const review = page.getByRole('button', { name: 'Request AI review' });
  if (await review.isEnabled()) {
    const evaluation = page.waitForResponse(response => response.url().endsWith('/api/v1/architecture/evaluate'), { timeout: 60_000 });
    await review.click();
    const reply = await evaluation;
    if (reply.ok()) {
      await expect(page.getByText('Advisory review', { exact: false })).toBeVisible();
    } else {
      await expect(page.getByRole('complementary', { name: 'RH Planner AI Assistant' }).getByRole('alert')).not.toBeEmpty();
      console.log('Architectural review response', reply.status());
    }
  } else {
    await expect(page.getByText('Resolve the current geometry findings', { exact: false })).toBeVisible();
  }
  await page.screenshot({ path: info.outputPath('09-assistant.png') });
  await page.getByRole('button', { name: 'Close assistant' }).click();
  await page.getByTestId('nav-isometric').click();
  await expect(page.getByTestId('isometric-3d-viewport').locator('canvas')).toBeVisible({ timeout: 25000 });
  await page.screenshot({ path: info.outputPath('09b-floor-study.png') });
  await page.getByTestId('nav-building_3d').click();
  await expect(page.getByTestId('building-3d-customizer').locator('canvas').first()).toBeVisible({ timeout: 25000 });
  await page.screenshot({ path: info.outputPath('10a-building-overview.png') });
  const modelCanvas = page.getByTestId('building-3d-customizer').locator('canvas').first();
  const orthographic = page.getByRole('button', { name: 'Orthographic', exact: true });
  const sectionCut = page.getByRole('button', { name: 'Section cut', exact: true });
  await orthographic.click();
  await expect(modelCanvas).toHaveAttribute('data-projection', 'orthographic');
  await page.getByTestId('camera-preset-back').click();
  await sectionCut.click();
  await expect(modelCanvas).toHaveAttribute('data-section', 'on');
  await page.screenshot({ path: info.outputPath('10b-orthographic-section.png') });
  await sectionCut.click();
  await orthographic.click();
  await page.getByTestId('camera-preset-isometric').click();
  await expect(modelCanvas).toHaveAttribute('data-projection', 'perspective');
  await page.getByText('Built façade reference', { exact: true }).click();
  await page.locator('.rh-finish-reference img').evaluate((image: HTMLImageElement) => image.decode());
  await expect(page.getByRole('link', { name: /Balcony rhythm/ })).toBeVisible();
  await page.getByText('Built façade reference', { exact: true }).click();
  await page.getByTestId('floor-mode-isolate').click();
  const level = page.locator('[data-testid^="model-level-"]').nth(1);
  await level.click();
  await expect(level).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: info.outputPath('10-building-3d.png') });
  await page.getByTestId('fixture-opt-casement_timber_win').click();
  await page.getByTestId('btn-apply-global-skin').click();
  await expect(page.getByTestId('feedback-notice')).toContainText('Global skin applied');
  await page.getByRole('button', { name: 'Save project' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('building-3d-customizer').locator('canvas').first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('11-mobile-3d.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId('nav-structural_cad').click();
  await expect(page.getByText('Professional review required', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('11b-structural-cad.png') });
  await page.getByTestId('nav-engineering').click();
  const violations = page.getByRole('button', { name: /violations checks/ });
  await violations.click();
  await expect(violations).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: info.outputPath('11c-engineering.png') });
  await page.getByRole('tab', { name: 'ETABS Structural Analysis' }).click();
  await expect(page.getByText('Verified analysis results are unavailable', { exact: false })).toBeVisible();
  await page.screenshot({ path: info.outputPath('11d-etabs.png') });
  await page.getByTestId('nav-export').click();
  await expect(page.getByRole('heading', { name: 'Export Center' })).toBeVisible();
  await page.locator('.rh-delivery-cover img').evaluate((image: HTMLImageElement) => image.decode());
  await page.screenshot({ path: info.outputPath('12-export.png') });
  await page.getByRole('link', { name: 'Model files', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download building GLB' })).toBeInViewport();
  await page.getByRole('link', { name: 'Drawing sheets', exact: true }).click();
  await page.screenshot({ path: info.outputPath('12b-export-sheets.png') });
  for (const [name, ext, signature] of [
    ['Download 01 Site Plan pdf', 'pdf', '%PDF-'],
    ['Download 01 Site Plan dxf', 'dxf', '0'],
    ['Download 01 Site Plan dwg', 'dwg', 'AC'],
    ['Download building GLB', 'glb', 'glTF'],
    ['Download CSI ETABS (.e2k)', 'e2k', ''],
  ]) {
    const downloading = page.waitForEvent('download', { timeout: 40_000 });
    await page.getByRole('button', { name, exact: true }).click();
    const result = await downloading;
    expect(result.suggestedFilename()).toMatch(new RegExp(`\\.${ext}$`, 'i'));
    const path = info.outputPath(result.suggestedFilename());
    await result.saveAs(path);
    const bytes = await readFile(path);
    expect(bytes.length).toBeGreaterThan(30);
    if (signature) expect(bytes.toString('ascii').trimStart().startsWith(signature)).toBe(true);
  }
  const revision = (await page.locator('.rh-export-header .rh-kicker').textContent())?.trim();
  expect(revision).toMatch(/revision \d+/);
  await page.reload();
  await page.getByTestId('nav-export').click();
  await expect(page.locator('.rh-export-header .rh-kicker')).toHaveText(revision);
  await page.getByRole('button', { name: 'Project library', exact: true }).click();
  const library = page.getByRole('region', { name: 'Project library' });
  const saved = library.getByRole('article').filter({
    hasText: new RegExp('RH Browser Acceptance.*' + revision?.match(/revision \d+/i)?.[0], 'i'),
  });
  await expect(saved.getByRole('img', { name: /Plan preview/ })).toBeVisible();
  await saved.getByText('Saved revision history', { exact: true }).click();
  await expect(saved.locator('ol li').first()).toContainText(/Revision \d+/);
  await expect.poll(() => saved.locator('ol li').count()).toBeGreaterThan(1);
  await page.screenshot({ path: info.outputPath('13-library.png') });
  await saved.getByRole('button', { name: 'Open project' }).click();
  await expect(page.getByTestId('nav-cad_2d')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('project-switcher-trigger')).toContainText('RH Browser Acceptance');
  console.log('Failed HTTP responses', failedRequests);
  expect(errors).toEqual([]);
});
