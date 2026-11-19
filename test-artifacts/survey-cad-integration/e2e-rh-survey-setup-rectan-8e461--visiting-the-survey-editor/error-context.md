# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e\rh-survey-setup.spec.ts >> rectangular setup still generates a real concept after visiting the survey editor
- Location: e2e\rh-survey-setup.spec.ts:127:1

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator: locator('.three-building-scene canvas')
Expected: "perspective"
Timeout: 20000ms
Error: element(s) not found

Call log:
  - Expect "toHaveAttribute" locator('.three-building-scene canvas') with timeout 20000ms
  - waiting for locator('.three-building-scene canvas')

```

```yaml
- banner:
  - button "PLANNER"
  - button "Manu Residences Towers":
    - img
    - text: Manu Residences Towers
    - img
  - navigation "Studio Workspaces":
    - button "Brief":
      - img
      - text: Brief
    - button "Massing":
      - img
      - text: Massing
    - button "2D CAD":
      - img
      - text: 2D CAD
    - button "Edit Plan":
      - img
      - text: Edit Plan
    - button "Floor 3D":
      - img
      - text: Floor 3D
    - button "Tower 3D":
      - img
      - text: Tower 3D
    - button "Structural":
      - img
      - text: Structural
    - button "Compliance":
      - img
      - text: Compliance
    - button "Exports":
      - img
      - text: Exports
  - group "Measurement Units":
    - button "FT" [pressed]
    - button "M"
  - group "Viewport Lighting":
    - button "Day":
      - img
      - text: Day
    - button "Sunset" [pressed]:
      - img
      - text: Sunset
    - button "Night":
      - img
      - text: Night
  - button "100/100":
    - img
    - text: 100/100
- main: Loading Tower 3D PBR Engine...
```

# Test source

```ts
  46  |   await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  47  |   await page.mouse.down();
  48  |   await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 13, { steps: 5 });
  49  |   await page.mouse.up();
  50  |   await expect(outline).not.toHaveAttribute('d', startOutline!);
  51  |   await page.getByRole('button', { name: 'Undo survey edit' }).click();
  52  |   await expect(outline).toHaveAttribute('d', startOutline!);
  53  |   await page.getByRole('button', { name: 'Redo survey edit' }).click();
  54  |   await expect(outline).not.toHaveAttribute('d', startOutline!);
  55  |   const editedOutline = await outline.getAttribute('d');
  56  |   await page.getByRole('button', { name: 'Zoom in' }).click();
  57  |   await expect(outline).not.toHaveAttribute('d', editedOutline!);
  58  |   const zoomedOutline = await outline.getAttribute('d');
  59  |   await page.getByRole('button', { name: 'Pan drawing' }).click();
  60  |   const map = page.getByRole('group', { name: 'Survey boundary drawing' });
  61  |   const canvas = (await map.boundingBox())!;
  62  |   await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  63  |   await page.mouse.down();
  64  |   await page.mouse.move(canvas.x + canvas.width / 2 + 17, canvas.y + canvas.height / 2 + 12);
  65  |   await page.mouse.up();
  66  |   await expect(outline).not.toHaveAttribute('d', zoomedOutline!);
  67  |   await page.getByRole('button', { name: 'Fit boundary' }).click();
  68  |   await expect(outline).toHaveAttribute('d', editedOutline!);
  69  | 
  70  |   await page.getByLabel('Survey input').selectOption('angles');
  71  |   await page.getByRole('button', { name: 'Select vertex A', exact: true }).click();
  72  |   await page.getByLabel('Interior angle A (°)').fill('89');
  73  |   await page.getByLabel('Interior angle A (°)').press('Tab');
  74  |   await expect(page.getByText(/corner angles differ/)).toBeVisible();
  75  |   await page.getByRole('button', { name: 'Undo survey edit' }).click();
  76  |   await expect(outline).toBeVisible();
  77  |   await page.getByLabel('Survey input').selectOption('bearings');
  78  |   await page.getByLabel('Length A–B (m)').fill('22');
  79  |   await page.getByLabel('Length A–B (m)').press('Tab');
  80  |   await expect(page.getByText(/Traverse closure error/)).toBeVisible();
  81  |   await expect(outline).toHaveCount(0);
  82  |   await page.screenshot({ path: info.outputPath('survey-desktop-open-traverse.png') });
  83  |   await page.getByRole('button', { name: 'Undo survey edit' }).click();
  84  |   await expect(outline).toBeVisible();
  85  |   await page.reload();
  86  |   await expect(page.getByRole('button', { name: 'Surveyed boundary' })).toHaveAttribute('aria-pressed', 'true');
  87  |   await expect(page.getByLabel('Survey input')).toHaveValue('bearings');
  88  |   await page.getByRole('button', { name: 'Reference Upload', exact: true }).click();
  89  |   const generate = page.getByRole('button', { name: 'Generate Architectural Project' });
  90  |   await expect(generate).toBeDisabled();
  91  |   await expect(page.getByTestId('survey-generation-block')).toContainText('exact site boundary');
  92  |   expect(errors).toEqual([]);
  93  | });
  94  | 
  95  | test('mobile surveyed DXF import, fractional input and manual drawing', async ({ page }, info) => {
  96  |   await page.setViewportSize({ width: 390, height: 844 });
  97  |   await page.emulateMedia({ reducedMotion: 'reduce' });
  98  |   await openSite(page);
  99  |   await page.getByRole('button', { name: 'Surveyed boundary' }).click();
  100 |   await page.getByText('Import a surveyed boundary', { exact: true }).click();
  101 |   await page.getByLabel('DXF source units').selectOption('m');
  102 |   const dxf = [
  103 |     '0', 'SECTION', '2', 'ENTITIES', '0', 'LWPOLYLINE', '90', '4', '70', '1',
  104 |     '10', '0', '20', '0', '42', '-0.5', '10', '24', '20', '0',
  105 |     '10', '22', '20', '-34', '10', '0', '20', '-40', '0', 'ENDSEC', '0', 'EOF',
  106 |   ].join('\n');
  107 |   await page.getByLabel('Survey boundary DXF').setInputFiles({ name: 'curved-survey.dxf', mimeType: 'application/dxf', buffer: Buffer.from(dxf) });
  108 |   await expect(page.getByText('Source · curved-survey.dxf')).toBeVisible();
  109 |   await expect(page.getByTestId('survey-arc')).toHaveCount(1);
  110 |   await page.getByLabel('Display units').selectOption('ft');
  111 |   await page.getByLabel('East A (ft)').fill('2 1/2');
  112 |   await page.getByLabel('East A (ft)').press('Tab');
  113 |   await expect(page.getByLabel('East A (ft)')).toHaveValue('2.5');
  114 |   expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  115 |   await page.getByTestId('survey-drawing').screenshot({ path: info.outputPath('survey-mobile-dxf.png') });
  116 |   await page.getByLabel('Starting outline').selectOption('custom');
  117 |   await page.getByRole('button', { name: 'Draw vertices' }).click();
  118 |   const drawing = page.getByRole('group', { name: 'Survey boundary drawing' });
  119 |   for (const position of [{ x: 90, y: 70 }, { x: 250, y: 85 }, { x: 190, y: 190 }]) {
  120 |     await drawing.click({ position });
  121 |   }
  122 |   await expect(page.getByTestId('survey-outline')).toBeVisible();
  123 |   await page.getByRole('button', { name: 'Remove vertex C' }).click();
  124 |   await expect(page.getByTestId('survey-outline')).toHaveCount(0);
  125 | });
  126 | 
  127 | test('rectangular setup still generates a real concept after visiting the survey editor', async ({ page }, info) => {
  128 |   test.setTimeout(150_000);
  129 |   await page.setViewportSize({ width: 1440, height: 900 });
  130 |   const errors: string[] = [];
  131 |   page.on('pageerror', error => errors.push(error.message));
  132 |   await openSite(page);
  133 |   await page.getByRole('button', { name: 'Surveyed boundary' }).click();
  134 |   await page.getByLabel('Starting outline').selectOption('trapezoid');
  135 |   await page.getByRole('button', { name: 'Rectangular site', exact: true }).click();
  136 |   await page.getByRole('button', { name: 'Reference Upload', exact: true }).click();
  137 |   const request = page.waitForRequest(candidate => candidate.url().endsWith('/api/v1/projects/generate'));
  138 |   await page.getByRole('button', { name: 'Generate Architectural Project' }).click();
  139 |   expect((await request).postDataJSON().config.plotWidthMm).toBe(30_000);
  140 |   const gallery = page.getByRole('region', { name: 'Massing studies gallery' });
  141 |   await expect(gallery.getByRole('img', { name: /Plan preview/ }).first()).toBeVisible({ timeout: 100_000 });
  142 |   await page.screenshot({ path: info.outputPath('rectangular-generated-concept.png') });
  143 |   await gallery.getByRole('button', { name: 'Open in CAD' }).click();
  144 |   await page.getByTestId('nav-building_3d').click();
  145 |   const model = page.locator('.three-building-scene canvas');
> 146 |   await expect(model).toHaveAttribute('data-projection', 'perspective', { timeout: 20_000 });
      |                       ^ Error: expect(locator).toHaveAttribute(expected) failed
  147 |   await page.getByRole('button', { name: 'Orthographic' }).click();
  148 |   await expect(model).toHaveAttribute('data-projection', 'orthographic');
  149 |   await page.getByRole('button', { name: 'Section cut' }).click();
  150 |   await expect(model).toHaveAttribute('data-section', 'on');
  151 |   expect(errors).toEqual([]);
  152 | });
  153 | 
```