import { expect, test } from '@playwright/test';
import type { Building } from '@ai-floor-planner/core';

test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } });

test('Phase 5 unified architectural studio: 4-mode nav, warm-paper theme, protected Flat 2 regen, BIM schedule/assistant, live 3D furniture, undo/redo, and save/reload (Desktop 1440x900)', async ({
  page, request,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const pageErrors: string[] = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  await page.goto('/');
  await page.getByTestId('cta-new-construction').click();

  // Toggle Warm Architectural Paper surface theme and verify attribute updates
  const surfaceToggle = page.getByTestId('studio-surface-theme-toggle');
  await expect(surfaceToggle).toBeVisible();
  const initialSurface = await page.locator('.rh-obsidian-shell').getAttribute('data-studio-surface');
  await surfaceToggle.click();
  const nextSurface = await page.locator('.rh-obsidian-shell').getAttribute('data-studio-surface');
  expect(nextSurface).not.toBe(initialSurface);
  if (nextSurface !== 'warm-paper') await surfaceToggle.click();
  await expect(page.locator('.rh-obsidian-shell')).toHaveAttribute('data-studio-surface', 'warm-paper');
  await expect(page.getByTestId('nav-setup')).toHaveCSS('color', 'rgb(34, 29, 24)');


  // Verify 4-mode navigation grouping attributes exist cleanly
  await expect(page.getByTestId('nav-setup')).toHaveAttribute('data-mode-group', 'Design');
  await expect(page.getByTestId('nav-cad_2d')).toHaveAttribute('data-mode-group', 'Drafting');
  await expect(page.getByTestId('nav-bim')).toHaveAttribute('data-mode-group', 'BIM Coordination');
  await expect(page.getByTestId('nav-structural_cad')).toHaveAttribute('data-mode-group', 'Structural');

  // Generate a 4-flat residential project
  await page.getByLabel('Project Title / Estate', { exact: false }).fill('Phase 5 Unified Studio Tower');
  for (const step of [2, 3, 4]) {
    await page.getByRole('button', { name: 'Continue to Step 0' + step }).click();
  }
  await page
    .getByPlaceholder('Describe room layout preferences', { exact: false })
    .fill('Well-proportioned 2BHK and 3BHK apartments with cross ventilation and open stilt parking.');

  const genWait = page.waitForResponse(
    res => res.url().endsWith('/api/v1/projects/generate'),
    { timeout: 60_000 },
  );
  await page.getByRole('button', { name: 'Generate Architectural Project' }).click();
  const generated = await genWait;
  expect(generated.status()).toBe(200);
  const { building } = await generated.json() as { building: Building };
  const floor = building.floors.find(candidate => (candidate.apartmentUnits?.length ?? 0) > 1)!;
  expect(floor?.id).toBeTruthy();

  const gallery = page.getByRole('region', { name: 'Massing studies gallery' });
  await expect(gallery.getByRole('heading', { name: 'Massing Studies' })).toBeVisible({ timeout: 30_000 });
  await gallery.getByRole('button', { name: 'Open in CAD' }).click();

  await page.getByRole('button', { name: floor.name, exact: true }).first().click();
  await page.getByTestId('toggle-precision-cad-studio').click();
  await expect(page.getByTestId('precision-cad-workbench')).toBeVisible();

  // Accept a Protected Localized Single-Flat Regeneration on Flat 2 and verify Undo/Redo
  const revTextBefore = await page.getByTestId('cad-revision-badge').textContent();
  const revBefore = Number(revTextBefore?.match(/Rev\s+(\d+)/)?.[1] ?? '1');

  await page
    .getByTestId('cad-ai-instruction-input')
    .fill('Regenerate only Flat 2 while keeping the remaining flats unchanged');
  const cadResponse = page.waitForResponse(res => res.url().endsWith('/api/v1/cad/edit-proposal'));
  await page.getByTestId('cad-ai-preview-btn').click();
  const cad = await cadResponse;
  expect(cad.status()).toBe(200);
  const { proposal } = await cad.json();
  expect(proposal.status, proposal.message).toBe('PREVIEW_READY');
  expect(proposal.invarianceProof?.passed).toBe(true);
  expect(proposal.invarianceProof?.beforeProtectedDigest).toBe(proposal.invarianceProof?.afterProtectedDigest);
  await expect(page.getByTestId('cad-ai-preview-status')).toHaveText('PREVIEW_READY');
  await page.getByTestId('cad-ai-accept-btn').click();
  await expect(page.getByTestId('cad-revision-badge')).toContainText(`Rev ${revBefore + 1}`);

  await page.getByTestId('cad-undo-btn').click();
  await expect(page.getByTestId('cad-revision-badge')).toContainText(`Rev ${revBefore}`);
  await page.getByTestId('cad-redo-btn').click();
  await expect(page.getByTestId('cad-revision-badge')).toContainText(`Rev ${revBefore + 1}`);

  // Open BIM Studio, run deterministic schedule assistant query (0 API calls), and jump to CAD
  await page.getByTestId('nav-bim').click();
  const bimQuestionInput = page.getByLabel('Model query');
  await expect(bimQuestionInput).toBeVisible({ timeout: 20_000 });
  await bimQuestionInput.fill('Total window area');
  await bimQuestionInput.press('Enter');
  await expect(page.getByText(/m² of window openings/)).toBeVisible();

  const bim = page.getByRole('region', { name: 'RH Planner — BIM Studio' });
  await bim.getByRole('combobox', { name: 'BIM schedule' }).selectOption('window');
  const row = bim.getByRole('table').getByRole('button').first();
  await row.click();
  const inspector = bim.getByRole('region', { name: 'BIM property inspector' });
  const windowId = (await inspector.locator('dd').first().textContent())!.trim();
  expect(windowId).not.toBe('');
  await bim.getByRole('button', { name: 'Precision CAD', exact: true }).click();
  await expect(page.getByTestId('cad-direct-canonical-editor')).toBeVisible();
  await expect(page.getByTestId('cad-direct-opening-width-input')).toBeVisible();

  // Open Tower 3D and verify live interactive furniture category controls (zero disabled Phase 8 placeholders!)
  await page.getByTestId('nav-building_3d').click();
  const towerCanvas = page.locator('.three-building-scene canvas').first();
  await expect(towerCanvas).toHaveAttribute('data-draw-calls', /^[1-9]\d*$/, { timeout: 45_000 });

  await page.getByTestId('tab-furniture').click();
  await expect(towerCanvas).toHaveAttribute('data-selected-canonical-id', windowId);
  const cutaway = page.getByTestId('btn-toggle-furniture-cutaway');
  if ((await cutaway.getAttribute('aria-pressed')) !== 'true') await cutaway.click();
  await expect(towerCanvas).toHaveAttribute('data-visible-furniture-categories', /bed_master/);
  const bedToggle = page.getByTestId('furniture-opt-bed_master');
  await expect(bedToggle).toHaveAttribute('aria-pressed', 'true');
  await bedToggle.click();
  await expect(bedToggle).toHaveAttribute('aria-pressed', 'false');
  await expect(cutaway).toHaveAttribute('aria-pressed', 'true');
  await expect(towerCanvas).not.toHaveAttribute('data-visible-furniture-categories', /bed_master/);
  await page.getByTestId('btn-lighting-night').click();
  await expect(towerCanvas).toHaveAttribute('data-lighting', 'night');

  await page.getByTestId('nav-cad_2d').click();
  await expect(towerCanvas).toHaveCount(0);

  // Save to local disk and verify toast
  const diskResponse = page.waitForResponse(res =>
    res.request().method() === 'POST' && res.url().endsWith('/api/v1/local-projects'));
  await page.getByTestId('topbar-save-local').click();
  const disk = await diskResponse;
  expect(disk.status()).toBe(200);
  await expect(page.getByTestId('local-save-toast')).toContainText('Saved', { timeout: 15_000 });
  const saved = await disk.json();
  expect(saved.building.version).toBe(revBefore + 1);
  expect(saved.digest).toMatch(/^[0-9a-f]{64}$/);
  const stored = await request.get(`/api/v1/local-projects/${saved.building.projectId}`);
  expect(stored.ok()).toBe(true);
  expect((await stored.json()).digest).toBe(saved.digest);
  await page.reload();
  await expect(page.getByTestId('project-switcher-trigger')).toContainText(saved.building.name);

  expect(pageErrors).toEqual([]);
});

test('Phase 5 mobile studio responsiveness: navigation and BIM schedule access cleanly at 390x844', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByTestId('cta-new-construction').click();
  await expect(page.getByTestId('nav-cad_2d')).toBeVisible();
  await page.getByTestId('nav-bim').click();
  await expect(page.getByRole('heading', { name: /BIM|Schedule|Quantities/i }).first()).toBeVisible({ timeout: 20_000 });
});
