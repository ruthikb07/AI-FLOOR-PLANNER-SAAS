import { expect, test, type Locator } from '@playwright/test';
import type { Building } from '@ai-floor-planner/core';
import { readFile } from 'node:fs/promises';

test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } });

type WebGLProbe = {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  lose: () => void;
  lost: number;
  restored: number;
  prevented: boolean;
  draws: number;
  frames: number;
};

declare global {
  interface Window {
    rhWebGLProbes: Record<string, WebGLProbe>;
  }
}

async function monitor(canvas: Locator, key: string) {
  await expect(canvas).toHaveAttribute('data-draw-calls', /^[1-9]\d*$/, { timeout: 45_000 });
  await expect(canvas).toBeVisible();
  const supported = await canvas.evaluate((element: HTMLCanvasElement, id) => {
    const gl = element.getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_lose_context');
    if (!gl || !extension) return false;
    const probe: WebGLProbe = {
      canvas: element, gl, lose: () => extension.loseContext(),
      lost: 0, restored: 0, prevented: false, draws: 0, frames: 0,
    };
    (window.rhWebGLProbes ??= {})[id] = probe;
    new MutationObserver(records => {
      probe.frames += records.filter(record => record.target === element && element.hasAttribute('data-draw-calls')).length;
    }).observe(element, { attributeFilter: ['data-draw-calls'] });
    const drawElements = gl.drawElements.bind(gl);
    gl.drawElements = (mode, count, type, offset) => {
      if (!gl.isContextLost() && count > 0) probe.draws++;
      drawElements(mode, count, type, offset);
    };
    const drawArrays = gl.drawArrays.bind(gl);
    gl.drawArrays = (mode, first, count) => {
      if (!gl.isContextLost() && count > 0) probe.draws++;
      drawArrays(mode, first, count);
    };
    element.addEventListener('webglcontextlost', event => {
      probe.lost++;
      probe.prevented = event.defaultPrevented;
      // Chromium defers the point at which the lost-context extension can restore.
      if (element.isConnected && probe.prevented) setTimeout(() => extension.restoreContext(), 1_000);
    });
    element.addEventListener('webglcontextrestored', () => { probe.restored++; });
    return true;
  }, key);
  expect(supported, 'Chromium exposes a real WebGL2 context and the loss extension').toBe(true);

  const read = () => canvas.page().evaluate(id => {
    const { gl, canvas: element, lost, restored, prevented, frames, draws } = window.rhWebGLProbes[id]!;
    const { geometries, textures, triangles } = element.dataset;
    return {
      lost, restored, prevented, frames, draws,
      detached: !element.isConnected,
      contextLost: gl.isContextLost(),
      resources: { geometries: Number(geometries), textures: Number(textures), triangles: Number(triangles) },
    };
  }, key);

  return {
    read,
    async recover() {
      const before = await read();
      await canvas.page().evaluate(id => window.rhWebGLProbes[id]!.lose(), key);
      await expect.poll(async () => (await read()).lost).toBe(before.lost + 1);
      await expect(canvas).toHaveAttribute('data-context-status', 'lost');
      await expect.poll(async () => (await read()).restored, { timeout: 20_000 }).toBe(before.restored + 1);
      await expect(canvas).toHaveAttribute('data-context-status', 'active');
      await expect(canvas).toHaveAttribute('data-draw-calls', /^[1-9]\d*$/, { timeout: 20_000 });
      const after = await read();
      expect(after).toMatchObject({ prevented: true, detached: false, contextLost: false, frames: before.frames + 1 });
      expect(after.draws).toBeGreaterThan(before.draws);
      // Hidden floors and former lighting maps need not be re-uploaded.
      expect(after.resources.geometries).toBeLessThanOrEqual(before.resources.geometries);
      expect(after.resources.textures).toBeLessThanOrEqual(before.resources.textures);
      expect(after.resources.triangles).toBeGreaterThan(0);
      await canvas.page().waitForTimeout(750);
      expect(await read()).toEqual(after);
      console.log('RH_WEBGL_RECOVERY', {
        view: key, cycle: after.restored, frames: after.frames - before.frames,
        glDraws: after.draws - before.draws, before: before.resources, after: after.resources,
      });
    },
    async verifyReleased() {
      await expect.poll(read, { timeout: 20_000 }).toMatchObject({ detached: true, contextLost: true });
      const detached = await read();
      await canvas.page().waitForTimeout(400);
      expect(await read()).toEqual(detached);
      console.log('RH_WEBGL_RELEASED', { view: key, frames: detached.frames, restored: detached.restored });
    },
  };
}

test('Tower and Floor 3D recover real WebGL frames, preserve view and release contexts', async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  const fixture = JSON.parse(await readFile(new URL('../../../test-artifacts/phase1-generated/four-flat-production-building.json', import.meta.url), 'utf8')) as Building;
  const floors = fixture.floors.filter(floor => floor.level === 1 || floor.level === 2);
  expect(floors).toHaveLength(2);
  const primaryId = 'phase35-webgl-primary';
  const alternateId = 'phase35-webgl-alternate';
  for (const projectId of [primaryId, alternateId]) {
    const saved = await request.post('/api/v1/local-projects', {
      data: {
        projectId,
        name: projectId,
        building: { ...fixture, projectId, floors: projectId === primaryId ? floors : floors.slice(0, 1) },
      },
    });
    expect(saved.status(), await saved.text()).toBe(200);
  }

  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('cta-open-existing').click();
  const openProject = (id: string) => page.getByTestId('disk-project-card-' + id).getByRole('button', { name: 'Open from Disk' }).click();
  await openProject(primaryId);
  await page.getByTestId('nav-building_3d').click();

  const tower = page.locator('.three-building-scene canvas');
  const front = page.getByTestId('camera-preset-front');
  const night = page.getByTestId('btn-lighting-night');
  const isolate = page.getByTestId('floor-mode-isolate');
  const upperFloor = page.getByTestId('model-level-' + floors[1]!.id);
  await front.click();
  await upperFloor.click();
  await isolate.click();
  await night.click();
  const towerProbe = await monitor(tower, 'tower');
  await page.waitForTimeout(1_250);
  const expectedView = await tower.screenshot();
  await towerProbe.recover();
  await towerProbe.recover();
  const restoredView = await tower.screenshot();
  if (!expectedView.equals(restoredView)) {
    await testInfo.attach('tower-before-context-loss', { body: expectedView, contentType: 'image/png' });
    await testInfo.attach('tower-after-restoration', { body: restoredView, contentType: 'image/png' });
  }
  expect(restoredView.equals(expectedView), 'the recovered canvas preserves the rendered view').toBe(true);
  await expect(front).toHaveClass(/\bactive\b/);
  for (const control of [night, isolate, upperFloor]) await expect(control).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('nav-isometric').click();
  await page.getByTestId('toggle-view-3d').click();
  await towerProbe.verifyReleased();
  const floor = page.getByTestId('isometric-3d-viewport').locator('canvas');
  const floorProbe = await monitor(floor, 'floor');
  await page.waitForTimeout(1_250);
  await floorProbe.recover();
  await floorProbe.recover();

  await page.getByTestId('nav-library').click();
  await openProject(alternateId);
  await floorProbe.verifyReleased();
  await expect(page.getByTestId('project-switcher-trigger')).toContainText(alternateId);
  await page.getByTestId('nav-building_3d').click();
  const otherProbe = await monitor(tower, 'second project tower');
  await page.waitForTimeout(1_250);
  await otherProbe.recover();
  await page.getByTestId('nav-cad_2d').click();
  await otherProbe.verifyReleased();
  expect(pageErrors).toEqual([]);
});
