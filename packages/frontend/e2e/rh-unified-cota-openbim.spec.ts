import { expect, test } from '@playwright/test';

test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } });

test('Unified AI Floor Planner + Cota CAD + OpenBIM Studio: single-shell CAD CLI, 3D solids, IDS 1.0, 5D QTO, COBie 2.4, 3D BVH clash, BCF 2.1 & Project Files', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const pageErrors: string[] = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  await page.goto('/');
  await page.getByTestId('cta-new-construction').click();

  // Verify unified navigation tabs exist in the single ARGON Studio topbar
  await expect(page.getByTestId('nav-pro_cad')).toBeVisible();
  await expect(page.getByTestId('nav-bim')).toBeVisible();
  await expect(page.getByTestId('nav-coordination')).toBeVisible();
  await expect(page.getByTestId('nav-project_files')).toBeVisible();

  const revPill = page.getByTestId('topbar-canonical-sync-pill');
  const initialRevText = await revPill.textContent();
  const initialRev = Number(initialRevText?.match(/Rev\s+#(\d+)/)?.[1] ?? '1');

  // 1. Switch to Professional CAD (Cota 2D/3D) without page reload
  await page.getByTestId('nav-pro_cad').click();
  await expect(page.getByTestId('cota-professional-cad-workspace')).toBeVisible();
  await expect(page.getByTestId('cota-cad-viewport').locator('canvas').first()).toBeVisible({ timeout: 25_000 });

  const entityReadout = await page.locator('[data-testid="cota-coords-readout"] + span + span').textContent();
  const initialEntityCount = Number(entityReadout?.match(/Entities:\s*(\d+)/)?.[1] ?? '0');
  expect(initialEntityCount).toBeGreaterThan(5);

  // Execute Cota CAD CLI commands (CIRCLE & 3D BOX)
  const cliInput = page.getByTestId('cota-cli-input');
  await cliInput.fill('CIRCLE');
  await cliInput.press('Enter');
  await cliInput.fill('1500,-1500');
  await cliInput.press('Enter');
  await cliInput.fill('400');
  await cliInput.press('Enter');

  // Open searchable 240+ Command Reference drawer
  await page.getByTestId('cota-cmd-ref-toggle').click();
  await expect(page.getByTestId('cota-command-reference-drawer')).toBeVisible();
  await page.getByTestId('cota-cmd-search-input').fill('EXTRUDE');
  await expect(page.getByTestId('cota-command-reference-drawer')).toContainText('EXTRUDE');
  await page.getByTestId('cota-cmd-ref-toggle').click();

  // Switch between Model and Paper-Space A3 Layout tab
  await page.getByTestId('cota-tab-layout-L1').click();
  await expect(page.getByTestId('cota-tab-layout-L1')).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('cota-tab-model').click();

  // Save .cota drawing & export vector PDF plot to Unified Project Files
  await page.getByTestId('cota-save-project-btn').click();
  await expect(page.getByRole('status')).toContainText('Unified Project Files');
  await page.getByTestId('cota-export-pdf').click();

  // 2. Switch seamlessly to BIM Studio (OpenBIM authoring, 5D QTO, COBie 2.4, IDS 1.0)
  await page.getByTestId('nav-bim').click();
  await expect(page.getByRole('region', { name: 'RH Planner — BIM Studio' })).toBeVisible();
  await expect(page.getByTestId('openbim-studio-panel')).toBeVisible();

  // Assign classification & validate/commit a 300mm wall edit to Canonical Building
  await page.getByTestId('openbim-assign-class-btn').click();
  await expect(page.getByTestId('openbim-status-banner')).toContainText('Assigned');

  await page.getByTestId('openbim-param-mm-input').fill('300');
  await page.getByTestId('openbim-preview-edit-btn').click();
  await expect(page.getByTestId('openbim-edit-preview')).toContainText('Validated:');
  await page.getByTestId('openbim-apply-edit-btn').click();
  await expect(revPill).toContainText(`Rev #${initialRev + 1}`);

  // 5D QTO & COBie 2.4 export
  await page.getByTestId('openbim-tab-qto').click();
  await expect(page.getByTestId('openbim-qto-total')).toContainText('₹');
  await page.getByTestId('openbim-export-cobie-xls').click();

  // IDS 1.0 Audit
  await page.getByTestId('openbim-tab-ids').click();
  await page.getByTestId('openbim-run-ids-btn').click();
  await expect(page.getByTestId('openbim-ids-pass-rate')).toContainText('100% Pass');

  // 3. Switch seamlessly to Model Coordination (3D BVH Clash + BCF 2.1)
  await page.getByTestId('nav-coordination').click();
  await expect(page.getByTestId('model-coordination-workspace')).toBeVisible();
  await page.getByTestId('coord-run-clash-btn').click();
  await expect(page.getByTestId('coord-status-banner')).toContainText('3D Clash Detection');
  await page.getByTestId('coord-log-clash-0').click();
  await expect(page.getByTestId('coord-bcf-card').first()).toBeVisible();
  await page.getByTestId('coord-export-bcf-btn').click();

  // 4. Switch seamlessly to Unified Project Files & verify revision governance
  await page.getByTestId('nav-project_files').click();
  const filesWs = page.getByTestId('project-files-workspace');
  await expect(filesWs).toBeVisible();
  await expect(filesWs).toContainText(`Revision #${initialRev + 1}`);
  // Earlier .cota drawing saved at initialRev is flagged OUTDATED; latest BCF/IDS/COBie are CURRENT
  await expect(filesWs).toContainText('(OUTDATED)');
  await expect(filesWs).toContainText('(CURRENT)');

  expect(pageErrors).toEqual([]);
});
