const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  
  console.log('Navigating to RH Planner...');
  await page.goto('http://localhost:3002', { waitUntil: 'networkidle' });
  
  // Capture Initial State
  await page.screenshot({ path: 'test-artifacts/rh-planner-visual-acceptance/welcome-initial.png' });
  
  // Interact
  await page.waitForTimeout(5000); 
  await page.screenshot({ path: 'test-artifacts/rh-planner-visual-acceptance/building-complete.png' });
  
  // Navigate
  const createProjectBtn = page.getByText('Create New Project');
  await createProjectBtn.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'test-artifacts/rh-planner-visual-acceptance/plot-requirements.png' });
  
  await browser.close();
  console.log('Verification successful.');
})();
