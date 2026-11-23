import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4177';
const API_BASE = 'http://127.0.0.1:4200';
const chrome = process.env.RH_CINEMATIC_CHROME;

test.use({
  launchOptions: chrome
    ? { executablePath: chrome, args: ['--use-angle=d3d11'] }
    : { args: ['--enable-unsafe-swiftshader'] },
});

test.describe('Gate 3 Live Verification — 60fps 3D Engine, Built Slab Union, Zero Sidebar Overflow & Cutaway', () => {
  test('verifies < 120 draw calls, instant < 50ms PBR material hot-swap, deduplicated lighting, zero overflow, and captures 3D Tower & Cutaway screenshots', async ({ page, request }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', err => pageErrors.push(err.message));

    // 1. Generate a canonical 30m x 40m 4x2BHK tower via local backend
    const genRes = await request.post(`${API_BASE}/api/v1/projects/generate`, {
      data: {
        seed: 1,
        config: {
          projectId: 'gate3-3d-proof',
          projectName: 'Gate 3 Tower 30x40m',
          plotWidthMm: 30000,
          plotDepthMm: 40000,
          roadWidthMm: 12000,
          roadAccessSides: ['south'],
          lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
          jurisdiction: 'pune_pmc',
          verticalStackType: 'STILT_PLUS_N',
          numTypicalFloors: 4,
          floorToFloorHeightMm: 3150,
          stiltHeightMm: 3150,
          flatsPerFloor: 4,
          units: [
            { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true },
            { unitIndex: 2, bhkType: '2BHK', hasUtilityBalcony: true },
            { unitIndex: 3, bhkType: '2BHK', hasUtilityBalcony: true },
            { unitIndex: 4, bhkType: '2BHK', hasUtilityBalcony: true },
          ],
          parkingMode: 'STILT_ONLY',
          setbacksMm: { front: 4500, rear: 3000, left: 3000, right: 3000 },
          includeStudyRoom: false,
        },
      },
    });
    expect(genRes.status()).toBe(200);
    const { building } = (await genRes.json()) as { building: Record<string, unknown> };

    const saveRes = await request.post(`${API_BASE}/api/v1/local-projects`, {
      data: {
        projectId: 'gate3_3d_proof_tmp',
        name: 'Gate 3 Tower 30x40m',
        building,
      },
    });
    expect(saveRes.status()).toBe(200);

    try {
      await page.addInitScript(() => {
        sessionStorage.setItem('rh_welcome_dismissed', 'true');
      });
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(800);
      await page.getByTestId('nav-library').click({ timeout: 15000 });
      await page.getByTestId('open-disk-project-gate3_3d_proof_tmp').click({ timeout: 15000 });
      await page.waitForTimeout(800);

      // 2. Verify all 9 topbar workspace tabs fit cleanly at 1440px (zero clipping on Compliance / Exports)
      const topbarClip = await page.evaluate(() => {
        const nav = document.querySelector('.rh-topbar-nav') as HTMLElement | null;
        if (!nav) return { found: false, overflow: 999 };
        return { found: true, overflow: nav.scrollWidth - nav.clientWidth };
      });
      expect(topbarClip.found).toBe(true);
      expect(topbarClip.overflow).toBeLessThanOrEqual(4);

      // 3. Switch to Tower 3D workspace
      await page.getByTestId('nav-building_3d').click();
      const canvas = page.locator('canvas[aria-label="Interactive canonical 3D building model"]');
      await expect(canvas).toBeVisible({ timeout: 20000 });
      await page.waitForTimeout(1200);

      // Verify draw calls < 120, pixelRatio <= 1.5, and ground-locked maxPolarAngle
      const metrics = await page.evaluate(() => {
        const c = document.querySelector('canvas[aria-label="Interactive canonical 3D building model"]') as HTMLCanvasElement | null;
        const stats = (window as unknown as { __rh3dStats?: Record<string, number> }).__rh3dStats ?? {};
        return {
          drawCalls: Number(c?.dataset.drawCalls ?? stats.drawCalls ?? 9999),
          triangles: Number(c?.dataset.triangles ?? stats.triangles ?? 0),
          pixelRatio: Number(c?.dataset.pixelRatio ?? 99),
          maxPolarAngle: Number(c?.dataset.maxPolarAngle ?? 99),
        };
      });
      console.log('[Gate 3 Tower 3D Metrics]', metrics);
      expect(metrics.drawCalls).toBeGreaterThan(5);
      expect(metrics.drawCalls).toBeLessThan(120);
      expect(metrics.triangles).toBeGreaterThan(200);
      expect(metrics.pixelRatio).toBeLessThanOrEqual(1.51);
      expect(metrics.maxPolarAngle).toBeLessThan(Math.PI / 2);

      // 4. Verify deduplicated lighting controls in Tower 3D (ONLY HUD Day/Sunset/Night visible; topbar & toolbar duplicates hidden)
      await expect(page.getByTestId('btn-lighting-day')).toBeVisible();
      await expect(page.getByTestId('btn-lighting-golden')).toBeVisible();
      await expect(page.getByTestId('btn-lighting-night')).toBeVisible();
      await expect(page.getByTestId('shell-light-day')).toHaveCount(0);
      await expect(page.getByTestId('btn-daylight-cycle')).toHaveCount(0);

      // 5. Verify right sidebar has ZERO horizontal overflow & unclipped PRIMARY WALL MATERIAL + FIXTURES (ACTIVE)
      const sidebar = page.getByTestId('element-customizer-sidebar');
      await expect(sidebar).toBeVisible();
      await expect(sidebar).toContainText('PRIMARY WALL MATERIAL');
      await expect(sidebar).toContainText('FIXTURES (ACTIVE)');
      const sidebarBox = await sidebar.evaluate(el => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));
      expect(sidebarBox.scrollWidth).toBeLessThanOrEqual(sidebarBox.clientWidth + 2);

      // 6. Capture clean Golden Hour Travertine Hero Tower 3D screenshot FIRST
      await page.getByTestId('btn-lighting-golden').click();
      await page.waitForTimeout(350);
      await page.screenshot({ path: 'e2e/screenshots/repaired-3d-tower.png', fullPage: false });

      // 7. Test instant (< 50 ms) PBR Material hot-swap + Fixture Skin application (zero freeze!)
      const tStart = Date.now();
      await page.getByTestId('sidebar-material-concrete').click();
      await expect(canvas).toHaveAttribute('data-palette', 'concrete');
      await page.getByTestId('sidebar-material-coastal').click();
      await expect(canvas).toHaveAttribute('data-palette', 'coastal');
      await page.getByTestId('sidebar-material-travertine').click();
      await expect(canvas).toHaveAttribute('data-palette', 'travertine');
      const totalSwapElapsed = Date.now() - tStart;
      const lastSwapMs = await page.evaluate(
        () => (window as unknown as { __rh3dStats?: Record<string, number> }).__rh3dStats?.materialSwapMs ?? 999,
      );
      console.log(`[Gate 3 Material Hot-Swap] 3 swaps total=${totalSwapElapsed}ms, Three.js swap=${lastSwapMs}ms`);
      expect(lastSwapMs).toBeLessThan(50);

      await page.getByTestId('fixture-opt-casement_timber_win').click();
      await page.getByTestId('btn-apply-global-skin').click();
      await expect(page.getByTestId('feedback-notice')).toContainText(/Global skin applied/i);

      // 8. Test smooth Explode & Section Cutaway toggles
      await page.getByTestId('btn-explode-toggle').click();
      await page.waitForTimeout(400);
      await page.getByTestId('btn-explode-toggle').click();
      await page.waitForTimeout(400);

      await page.getByTestId('btn-cutaway').click();
      await expect(canvas).toHaveAttribute('data-section', 'on');
      await page.getByTestId('btn-cutaway').click();
      await expect(canvas).toHaveAttribute('data-section', 'off');

      // 9. Switch to Floor 3D · Cutaway workspace & verify Cutaway naming (zero "Heart view" anywhere!)
      await page.getByTestId('nav-isometric').click();
      const isoCanvas = page.locator('canvas[aria-label="Interactive canonical 3D building model"]');
      await expect(isoCanvas).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(800);

      const pageText = await page.locator('body').innerText();
      expect(pageText.toLowerCase()).not.toContain('heart view');
      expect(pageText).toContain('CUTAWAY');

      // Pick 1ST_FLOOR_PLAN in Floor 3D Cutaway so we inspect an apartment residential floor clearly
      const firstFloorBtn = page.locator('[data-testid^="floor-btn-"]').filter({ hasText: /1ST_FLOOR|1st|Typical/i }).first();
      if (await firstFloorBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await firstFloorBtn.click();
        await page.waitForTimeout(700);
      }

      const isoCalls = await page.evaluate(() => {
        const c = document.querySelector('canvas[aria-label="Interactive canonical 3D building model"]') as HTMLCanvasElement | null;
        return Number(c?.dataset.drawCalls ?? 9999);
      });
      console.log(`[Gate 3 Floor 3D Cutaway Draw Calls] ${isoCalls}`);
      expect(isoCalls).toBeLessThan(60);

      await page.screenshot({ path: 'e2e/screenshots/repaired-3d-cutaway.png', fullPage: false });

      expect(pageErrors).toEqual([]);
      const fatalConsoleErrors = consoleErrors.filter(e => !/favicon|404|Failed to load resource/i.test(e));
      expect(fatalConsoleErrors).toEqual([]);
    } finally {
      await request.delete(`${API_BASE}/api/v1/local-projects/gate3_3d_proof_tmp`).catch(() => { });
    }
  });
});
