import { test, expect } from '@playwright/test';

test.use({
  video: 'on',
});

test.describe('RH Planner — Full Cinematic, CAD & 3D E2E Acceptance', () => {
  test('desktop 1440x900: welcome scrubbing, redevelopment, dining hall, generation, edit undo, 70/30 3D split & home reset', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });

    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('http://localhost:3000/');
    await page.waitForLoadState('networkidle');

    // 1. Welcome screen bright daylight & hero metric
    await expect(page.getByText('RH PLANNER', { exact: true }).first()).toBeVisible();
    await page.click('text=SKIP INTRO');
    await expect(page.locator('text=Δ = 0.000 mm²')).toBeVisible();

    const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bodyBg).not.toBe('rgb(10, 10, 10)');

    // 2. Scrub forward & backward via timeline pills without resetting to 0%
    await page.click('[data-testid="construction-stage-glazing"]');
    await page.waitForTimeout(700);
    await expect(page.locator('[data-testid="welcome-construction-scrubber"]')).toContainText('Assembly 70%');

    await page.click('[data-testid="construction-stage-roof"]');
    await page.waitForTimeout(700);
    await expect(page.locator('[data-testid="welcome-construction-scrubber"]')).toContainText('Assembly 89%');

    await page.click('[data-testid="construction-stage-site"]');
    await page.waitForTimeout(700);
    await expect(page.locator('[data-testid="welcome-construction-scrubber"]')).toContainText('Assembly 4%');

    // Check scrubber bar does not overlap the bottom CTA button/card
    const scrubberBox = await page.locator('[data-testid="welcome-construction-scrubber"]').boundingBox();
    const createBtnBox = await page.getByRole('button', { name: /Create New Project/i }).first().boundingBox();
    expect(scrubberBox).not.toBeNull();
    expect(createBtnBox).not.toBeNull();
    if (scrubberBox && createBtnBox) {
      const overlapsY =
        createBtnBox.y < scrubberBox.y + scrubberBox.height - 2 &&
        createBtnBox.y + createBtnBox.height > scrubberBox.y + 2;
      const overlapsX =
        createBtnBox.x < scrubberBox.x + scrubberBox.width - 2 &&
        createBtnBox.x + createBtnBox.width > scrubberBox.x + 2;
      expect(overlapsX && overlapsY).toBe(false);
    }

    await page.screenshot({ path: 'e2e/screenshots/01-welcome-daylight.png' });

    // 3. Redevelopment flow -> New Construction -> Step 2 -> Step 3 (Dining + H-Shape) -> Step 4 (Reference + Generate)
    await page.click('[data-testid="cta-redevelopment"]');
    await expect(page.locator('[data-testid="redevelopment-program-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="redevelopment-feasibility-card"]')).toBeVisible();

    await page.click('[data-testid="project-type-new-construction"]');
    await page.click('text=Continue to Step 02');
    await page.click('text=Continue to Step 03');

    await expect(page.locator('[data-testid="dining-hall-yes"]')).toBeVisible();
    await page.click('[data-testid="dining-hall-no"]');
    await page.click('[data-testid="dining-hall-yes"]');
    await page.click('[data-testid="massing-option-H_SHAPE_WING"]');

    await page.click('text=Continue to Step 04');
    await page.click('[data-testid="btn-load-sample-dxf"]');
    await expect(page.locator('[data-testid="reference-workflow-card"]')).toContainText('sample-survey-plot.dxf');
    await page.click('[data-testid="checkbox-reference-verified"]');

    // Trigger actual architectural project generation
    await page.getByRole('button', { name: /Generate Architectural Project/i }).click();
    await expect(page.locator('text=Compliance Score:')).toBeVisible({ timeout: 90_000 });
    const cadBodyText = await page.locator('body').innerText();
    expect(cadBodyText).not.toContain('269 findings');
    expect(cadBodyText).not.toContain('Best-effort plan');
    expect(cadBodyText).not.toContain('Compliance Score: 0 / 100');
    expect(cadBodyText).toContain('Verified');
    await expect(page.locator('[data-testid="footprint-vertex-classification"]')).toContainText('Polygonal');
    await page.screenshot({ path: 'e2e/screenshots/02-cad-2d-studio.png' });

    // 4. 03 • Edit Plan: verify real room dimensions & Undo restoration
    await page.click('[data-testid="nav-edit_plan"]');
    await expect(page.locator('[data-testid="edit-plan-drag-handles"]')).toBeVisible();
    const widthInput = page.locator('label:has-text("Width (mm)") input');
    const initialWidth = await widthInput.inputValue();
    expect(Number(initialWidth)).toBeGreaterThan(1000);
    expect(Number(initialWidth)).toBeLessThan(15000);

    await page.getByRole('button', { name: '+300mm Out' }).click();
    const expandedWidth = await widthInput.inputValue();
    // Apply Room Size / or if +300mm modified it, verify undo restores if history was pushed
    const undoBtn = page.locator('[data-testid="edit-plan-undo"]');
    if (await undoBtn.isEnabled()) {
      await undoBtn.click();
      expect(await widthInput.inputValue()).toBe(initialWidth);
    } else {
      await widthInput.fill(String(Number(expandedWidth || initialWidth) + 200));
      await page.getByRole('button', { name: /Apply Room Size/i }).click();
      await expect(undoBtn).toBeEnabled({ timeout: 15_000 });
      await undoBtn.click();
      expect(await widthInput.inputValue()).toBe(initialWidth);
    }
    await page.screenshot({ path: 'e2e/screenshots/03-edit-plan.png' });

    // 5. 04 • Floor Editor: 3D/2D viewport non-zero rect
    await page.click('[data-testid="nav-isometric"]');
    await expect(page.locator('[data-testid="floor-isometric-editor"]')).toBeVisible();
    const isoCanvasBox = await page.locator('[data-testid="isometric-3d-viewport"] canvas').first().boundingBox();
    expect(isoCanvasBox).not.toBeNull();
    expect(isoCanvasBox!.width).toBeGreaterThanOrEqual(400);
    expect(isoCanvasBox!.height).toBeGreaterThanOrEqual(350);
    await page.screenshot({ path: 'e2e/screenshots/04-floor-editor-3d.png' });

    // 6. 05 • 3D Building: strict 70/30 split layout + live controls
    await page.click('[data-testid="nav-building_3d"]');
    await expect(page.locator('[data-testid="building-3d-customizer"]')).toBeVisible();
    const mainCanvas = page.locator('[data-testid="building-3d-customizer"] main canvas').first();
    await expect(mainCanvas).toBeVisible();

    const canvasBox = await mainCanvas.boundingBox();
    const sidebarBox = await page.locator('[data-testid="element-customizer-sidebar"]').boundingBox();
    expect(canvasBox).not.toBeNull();
    expect(sidebarBox).not.toBeNull();
    expect(canvasBox!.width).toBeGreaterThanOrEqual(600);
    expect(canvasBox!.height).toBeGreaterThanOrEqual(500);
    expect(sidebarBox!.x).toBeGreaterThanOrEqual(600);
    expect(sidebarBox!.width).toBeLessThanOrEqual(410);

    await page.click('[data-testid="btn-lighting-night"]');
    await page.click('[data-testid="btn-lighting-day"]');
    await page.click('[data-testid="sidebar-material-concrete"]');
    await page.click('[data-testid="btn-apply-global-skin"]');
    await page.click('[data-testid="btn-walkthrough"]');
    await expect(page.locator('[data-testid="walkthrough-hud"]')).toBeVisible();
    await page.click('[data-testid="walk-forward"]');
    await page.click('[data-testid="btn-3d-zoom-in"]');
    await page.click('[data-testid="btn-reset-view"]');
    await page.screenshot({ path: 'e2e/screenshots/05-3d-building-split.png' });

    // 7. 06 • Structural CAD, 07 • Engineering, 08 • Export Center
    await page.click('[data-testid="nav-structural_cad"]');
    await page.waitForTimeout(250);
    await page.click('[data-testid="nav-engineering"]');
    await page.waitForTimeout(250);
    await page.click('[data-testid="nav-export"]');
    await page.waitForTimeout(250);
    await page.screenshot({ path: 'e2e/screenshots/06-export-center.png' });

    // 8. Home button cleanly resets Welcome to stage 0 without blurred intro curtain
    await page.click('[data-testid="nav-welcome"]');
    await expect(page.locator('[data-testid="welcome-intro-curtain"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Create New Project/i }).first()).toBeVisible();
    const scrollTopAfterReset = await page.evaluate(() => document.documentElement.scrollTop || window.scrollY);
    expect(scrollTopAfterReset).toBe(0);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('mobile 390x844: responsive welcome, setup, and 3D building canvas', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('http://localhost:3000/');
    await page.waitForLoadState('networkidle');
    await page.click('text=SKIP INTRO');
    await expect(page.locator('[data-testid="welcome-construction-scrubber"]')).toBeVisible();

    await page.getByRole('button', { name: /Launch Studio/i }).first().click();
    await page.click('[data-testid="nav-building_3d"]');
    await expect(page.locator('[data-testid="building-3d-customizer"]')).toBeVisible();
    const canvasBox = await page.locator('[data-testid="building-3d-customizer"] main canvas').first().boundingBox();
    expect(canvasBox).not.toBeNull();
    expect(canvasBox!.width).toBeGreaterThanOrEqual(280);
    expect(canvasBox!.height).toBeGreaterThanOrEqual(260);
    await page.screenshot({ path: 'e2e/screenshots/07-mobile-3d.png' });

    expect(pageErrors).toEqual([]);
  });
});
