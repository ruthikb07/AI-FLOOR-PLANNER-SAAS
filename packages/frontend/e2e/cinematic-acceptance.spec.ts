import { test, expect } from '@playwright/test';

test('cinematic welcome screen loads', async ({ page }) => {
  await page.goto('http://localhost:3002/');

  // Wait for the app to be interactive
  await page.waitForLoadState('networkidle');

  // Verify the branding text
  const logo = page.locator('text=RH PLANNER');
  await expect(logo).toBeVisible();

  // Capture screenshot of the initial state
  await page.screenshot({ path: 'tests/visual/welcome-screen.png' });
});

test('interactive navigation works', async ({ page }) => {
  await page.goto('http://localhost:3002/');

  // Skip intro to speed up testing
  await page.click('text=SKIP INTRO');

  // Verify main CTAs
  const createButton = page.locator('text=Create New Project');
  await expect(createButton).toBeVisible();

  await page.screenshot({ path: 'tests/visual/dashboard.png' });
});
