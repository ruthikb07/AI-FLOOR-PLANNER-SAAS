# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e\rh-cinematic-redesign.spec.ts >> production generation, PDF, CAD editing, 3D and verified downloads
- Location: e2e\rh-cinematic-redesign.spec.ts:92:1

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator:  locator('.rh-export-header .rh-kicker')
Expected: "RH BROWSER ACCEPTANCE · REVISION 426"
Received: "RH Browser Acceptance · revision 426"
Timeout:  5000ms

Call log:
  - Expect "toHaveText" locator('.rh-export-header .rh-kicker') with timeout 5000ms
  - waiting for locator('.rh-export-header .rh-kicker')
    13 × locator resolved to <p class="rh-kicker">RH Browser Acceptance · revision 426</p>
       - unexpected value "RH Browser Acceptance · revision 426"

```

```yaml
- paragraph: RH Browser Acceptance · revision 426
```

# Test source

```ts
  105 |   await page.getByLabel('Project Title / Estate', { exact: false }).fill('RH Browser Acceptance');
  106 |   await page.screenshot({ path: info.outputPath('05-project-setup.png') });
  107 |   for (const step of [2, 3, 4]) await page.getByRole('button', { name: `Continue to Step 0${step}` }).click();
  108 |   const prompt = page.getByPlaceholder('Describe room layout preferences', { exact: false });
  109 |   await prompt.fill('Prioritize natural light in the living rooms and separate private bedrooms from entry circulation.');
  110 |   const fileInput = page.locator('input[type=file]').first();
  111 |   await fileInput.setInputFiles({ name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('invalid') });
  112 |   await expect(page.getByText('The selected file does not have a valid PDF signature.')).toBeVisible();
  113 |   await fileInput.setInputFiles({ name: 'survey.pdf', mimeType: 'application/pdf', buffer: surveyPdf() });
  114 |   await expect(page.getByTitle('Reference PDF page preview')).toBeAttached();
  115 |   await expect(page.getByTestId('pdf-conversion-disclaimer')).toContainText('Drawing recognition and model reconstruction require manual input.');
  116 |   await page.getByTestId('checkbox-reference-verified').check();
  117 |   await page.screenshot({ path: info.outputPath('06-brief-and-pdf.png') });
  118 |   const generation = page.waitForRequest(request => request.url().endsWith('/api/v1/projects/generate'), { timeout: 30_000 });
  119 |   await page.getByRole('button', { name: 'Generate Architectural Project' }).click();
  120 |   await expect(page.getByRole('dialog', { name: 'Generating your building' })).toBeVisible();
  121 |   await page.screenshot({ path: info.outputPath('07-generation.png') });
  122 |   expect((await generation).method()).toBe('POST');
  123 |   await expect(page.getByText('Layout score', { exact: false }).first()).toBeVisible({ timeout: 115_000 });
  124 |   await page.screenshot({ path: info.outputPath('08-cad.png') });
  125 |   await page.getByTestId('nav-edit_plan').click();
  126 |   await expect(page.getByTestId('edit-plan-drag-handles')).toBeVisible();
  127 |   const width = page.locator('label:has-text("Width (mm)") input');
  128 |   const initial = await width.inputValue();
  129 |   await page.getByRole('button', { name: '+300mm Out' }).click();
  130 |   const rejection = page.getByRole('region', { name: 'Interactive Plan Editor Studio' }).getByRole('alert');
  131 |   const undo = page.getByTestId('edit-plan-undo');
  132 |   if (await rejection.isVisible()) {
  133 |     await expect(rejection).not.toBeEmpty();
  134 |     await expect(width).toHaveValue(initial);
  135 |   } else {
  136 |     await expect(undo).toBeEnabled();
  137 |     await expect(width).not.toHaveValue(initial);
  138 |     await undo.click();
  139 |     await expect(width).toHaveValue(initial);
  140 |   }
  141 |   await page.screenshot({ path: info.outputPath('08b-plan-editor.png') });
  142 |   await page.getByRole('button', { name: 'Design assistant' }).click();
  143 |   await expect(page.getByRole('complementary', { name: 'RH Planner AI Assistant' })).toContainText('Revision');
  144 |   await page.getByLabel('Review request').fill('Review circulation for the selected floor.');
  145 |   const review = page.getByRole('button', { name: 'Request AI review' });
  146 |   if (await review.isEnabled()) {
  147 |     const evaluation = page.waitForResponse(response => response.url().endsWith('/api/v1/architecture/evaluate'), { timeout: 60_000 });
  148 |     await review.click();
  149 |     const reply = await evaluation;
  150 |     if (reply.ok()) {
  151 |       await expect(page.getByText('Advisory review', { exact: false })).toBeVisible();
  152 |     } else {
  153 |       await expect(page.getByRole('complementary', { name: 'RH Planner AI Assistant' }).getByRole('alert')).not.toBeEmpty();
  154 |       console.log('Architectural review response', reply.status());
  155 |     }
  156 |   } else {
  157 |     await expect(page.getByText('Resolve the current geometry findings', { exact: false })).toBeVisible();
  158 |   }
  159 |   await page.screenshot({ path: info.outputPath('09-assistant.png') });
  160 |   await page.getByRole('button', { name: 'Close assistant' }).click();
  161 |   await page.getByTestId('nav-building_3d').click();
  162 |   await expect(page.getByTestId('building-3d-customizer').locator('canvas').first()).toBeVisible({ timeout: 25000 });
  163 |   await page.getByTestId('floor-mode-isolate').click();
  164 |   await page.locator('[data-testid^="model-level-"]').last().click();
  165 |   await expect(page.locator('[data-testid^="model-level-"]').last()).toHaveAttribute('aria-pressed', 'true');
  166 |   await page.screenshot({ path: info.outputPath('10-building-3d.png') });
  167 |   await page.getByTestId('fixture-opt-casement_timber_win').click();
  168 |   await page.getByTestId('btn-apply-global-skin').click();
  169 |   await expect(page.getByTestId('feedback-notice')).toContainText('Global skin applied');
  170 |   await page.getByRole('button', { name: 'Save project' }).click();
  171 |   await page.setViewportSize({ width: 390, height: 844 });
  172 |   await expect(page.getByTestId('building-3d-customizer').locator('canvas').first()).toBeVisible();
  173 |   await page.screenshot({ path: info.outputPath('11-mobile-3d.png') });
  174 |   await page.setViewportSize({ width: 1440, height: 900 });
  175 |   await page.getByTestId('nav-structural_cad').click();
  176 |   await expect(page.getByText('Professional review required', { exact: true })).toBeVisible();
  177 |   await page.screenshot({ path: info.outputPath('11b-structural-cad.png') });
  178 |   await page.getByTestId('nav-engineering').click();
  179 |   await page.getByRole('tab', { name: 'ETABS Structural Analysis' }).click();
  180 |   await expect(page.getByText('Verified analysis results are unavailable', { exact: false })).toBeVisible();
  181 |   await page.screenshot({ path: info.outputPath('11c-engineering.png') });
  182 |   await page.getByTestId('nav-export').click();
  183 |   await expect(page.getByRole('heading', { name: 'Export Center' })).toBeVisible();
  184 |   await page.screenshot({ path: info.outputPath('12-export.png') });
  185 |   for (const [name, ext, signature] of [
  186 |     ['Download 01 Site Plan pdf', 'pdf', '%PDF-'],
  187 |     ['Download 01 Site Plan dxf', 'dxf', '0'],
  188 |     ['Download 01 Site Plan dwg', 'dwg', 'AC'],
  189 |     ['Download building GLB', 'glb', 'glTF'],
  190 |     ['Download CSI ETABS (.e2k)', 'e2k', ''],
  191 |   ]) {
  192 |     const downloading = page.waitForEvent('download', { timeout: 40_000 });
  193 |     await page.getByRole('button', { name, exact: true }).click();
  194 |     const result = await downloading;
  195 |     expect(result.suggestedFilename()).toMatch(new RegExp(`\\.${ext}$`, 'i'));
  196 |     const path = info.outputPath(result.suggestedFilename());
  197 |     await result.saveAs(path);
  198 |     const bytes = await readFile(path);
  199 |     expect(bytes.length).toBeGreaterThan(30);
  200 |     if (signature) expect(bytes.toString('ascii').trimStart().startsWith(signature)).toBe(true);
  201 |   }
  202 |   const revision = await page.locator('.rh-export-header .rh-kicker').innerText();
  203 |   await page.reload();
  204 |   await page.getByTestId('nav-export').click();
> 205 |   await expect(page.locator('.rh-export-header .rh-kicker')).toHaveText(revision);
      |                                                              ^ Error: expect(locator).toHaveText(expected) failed
  206 |   await page.getByTestId('project-switcher-trigger').click();
  207 |   await expect(page.getByTestId('btn-new-project-from-switcher')).toBeVisible();
  208 |   await page.getByRole('button', { name: /RH Browser Acceptance.*FLOORS/i }).click();
  209 |   await expect(page.getByTestId('nav-cad_2d')).toHaveAttribute('aria-current', 'page');
  210 |   await expect(page.getByTestId('project-switcher-trigger')).toContainText('RH Browser Acceptance');
  211 |   console.log('Failed HTTP responses', failedRequests);
  212 |   expect(errors).toEqual([]);
  213 | });
  214 | 
```