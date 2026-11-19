# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e\rh-cinematic-redesign.spec.ts >> production generation, PDF, CAD editing, 3D and verified downloads
- Location: e2e\rh-cinematic-redesign.spec.ts:92:1

# Error details

```
TimeoutError: page.waitForResponse: Timeout 110000ms exceeded while waiting for event "response"
```

# Page snapshot

```yaml
- generic [ref=f2e3]:
  - banner [ref=f2e4]:
    - generic [ref=f2e5]:
      - button "RH Planner" [ref=f2e6] [cursor=pointer]
      - button "Welcome" [ref=f2e13] [cursor=pointer]
      - button "ACTIVE PROJECT Canonical 30×50 2BHK" [ref=f2e20] [cursor=pointer]:
        - generic [ref=f2e23]:
          - generic [ref=f2e24]: ACTIVE PROJECT
          - generic [ref=f2e25]: Canonical 30×50 2BHK
    - navigation "Project workspace" [ref=f2e28]:
      - button "Setup" [ref=f2e29] [cursor=pointer]
      - button "CAD" [ref=f2e34] [cursor=pointer]
      - button "Edit plan" [ref=f2e42] [cursor=pointer]
      - button "Floor 3D" [ref=f2e46] [cursor=pointer]
      - button "Building 3D" [ref=f2e52] [cursor=pointer]
      - button "Structural CAD" [ref=f2e57] [cursor=pointer]
      - button "Engineering" [ref=f2e63] [cursor=pointer]
      - button "Exports" [ref=f2e68] [cursor=pointer]
    - generic [ref=f2e73]:
      - button "Save project" [ref=f2e74] [cursor=pointer]
      - button "Night" [ref=f2e79] [cursor=pointer]
      - button "Design assistant" [disabled] [ref=f2e83]:
        - generic [ref=f2e86]: Assistant
      - button "Open command palette" [ref=f2e87] [cursor=pointer]:
        - generic [ref=f2e90]: Commands
  - main [ref=f2e91]:
    - generic [ref=f2e93]:
      - generic [ref=f2e94]:
        - generic [ref=f2e95]:
          - button "Welcome" [ref=f2e96] [cursor=pointer]
          - generic [ref=f2e100]: →
          - button "Project Type (New)" [ref=f2e101] [cursor=pointer]
          - generic [ref=f2e102]: →
          - button "Requirements" [ref=f2e103] [cursor=pointer]
          - generic [ref=f2e104]: →
          - button "Reference Upload" [ref=f2e105] [cursor=pointer]
          - generic [ref=f2e106]: →
          - generic [ref=f2e107]: Generation → 2D/3D → Engineering → Export
        - generic [ref=f2e108]: NEW CONSTRUCTION
      - generic [ref=f2e109]:
        - generic [ref=f2e116]:
          - generic [ref=f2e117]: Step 1 of 4
          - heading "Project type and site" [level=2] [ref=f2e118]
        - generic [ref=f2e119]:
          - button "01 Plot & Type New Build" [ref=f2e120] [cursor=pointer]:
            - generic [ref=f2e121]: "01"
            - generic [ref=f2e122]:
              - generic [ref=f2e123]: Plot & Type
              - generic [ref=f2e124]: New Build
          - button "02 Floors & Stilt Stacking & Duplex" [disabled] [ref=f2e126]:
            - generic [ref=f2e127]: "02"
            - generic [ref=f2e128]:
              - generic [ref=f2e129]: Floors & Stilt
              - generic [ref=f2e130]: Stacking & Duplex
          - button "03 Flats & Mix BHK & Massing" [disabled] [ref=f2e132]:
            - generic [ref=f2e133]: "03"
            - generic [ref=f2e134]:
              - generic [ref=f2e135]: Flats & Mix
              - generic [ref=f2e136]: BHK & Massing
          - button "04 Ref & Intent 5-Stage Upload" [disabled] [ref=f2e138]:
            - generic [ref=f2e139]: "04"
            - generic [ref=f2e140]:
              - generic [ref=f2e141]: Ref & Intent
              - generic [ref=f2e142]: 5-Stage Upload
      - generic [ref=f2e144]:
        - generic [ref=f2e145]:
          - generic [ref=f2e146]:
            - generic [ref=f2e147]:
              - text: Step 01 • Project Development Type
              - heading "Choose New Construction or Society / Building Redevelopment" [level=3] [ref=f2e148]
            - generic [ref=f2e149]: New Construction Active
          - generic [ref=f2e150]:
            - button "New Construction Greenfield or cleared parcel development with full statutory setbacks, stilt parking, and custom BHK massing." [ref=f2e151] [cursor=pointer]:
              - generic [ref=f2e157]:
                - generic [ref=f2e158]: New Construction
                - paragraph [ref=f2e159]: Greenfield or cleared parcel development with full statutory setbacks, stilt parking, and custom BHK massing.
            - button "Redevelopment Replace or extend an existing building with retained/demolished zones, duplex/triplex quotas & owner room briefs." [ref=f2e160] [cursor=pointer]:
              - generic [ref=f2e167]:
                - generic [ref=f2e168]: Redevelopment
                - paragraph [ref=f2e169]: Replace or extend an existing building with retained/demolished zones, duplex/triplex quotas & owner room briefs.
        - generic [ref=f2e171]:
          - generic [ref=f2e173]:
            - generic [ref=f2e174]: Project Title / Estate
            - textbox "Project Title / Estate" [ref=f2e176]:
              - /placeholder: e.g. ARGON Heights Phase 1
              - text: RH Browser Acceptance
          - generic [ref=f2e178]:
            - generic [ref=f2e179]: Planning Authority
            - combobox "Planning authority" [ref=f2e181] [cursor=pointer]:
              - option "Not selected — default statutory" [selected]
              - option "Municipal Corporation (PMC/PCMC)"
              - option "Municipal Council / Nagar Palika"
          - generic [ref=f2e183]:
            - generic [ref=f2e184]: UDCPR Congestion Zone
            - combobox "Congestion zone" [ref=f2e186] [cursor=pointer]:
              - option "Not selected — unverified" [selected]
              - option "Non-Congested (Standard FSI 1.10 - 2.0)"
              - option "Congested / Core City Ward"
        - generic [ref=f2e187]:
          - generic [ref=f2e188]:
            - generic [ref=f2e189]:
              - heading "Plot Boundaries & Frontage" [level=3] [ref=f2e190]
              - generic [ref=f2e198]: Metric Metres
            - generic [ref=f2e199]:
              - generic [ref=f2e200]:
                - generic [ref=f2e201]: Frontage (Width W)
                - generic [ref=f2e202]:
                  - spinbutton "Frontage (Width W)" [ref=f2e203]: "30"
                  - generic: m
              - generic [ref=f2e204]:
                - generic [ref=f2e205]: Depth (D)
                - generic [ref=f2e206]:
                  - spinbutton "Depth (D)" [ref=f2e207]: "40"
                  - generic: m
            - generic [ref=f2e208]:
              - generic [ref=f2e209]: "Gross Lot Area:"
              - generic [ref=f2e210]:
                - generic [ref=f2e211]: 1200 m²
                - generic [ref=f2e212]: (12,917 sq ft)
          - generic [ref=f2e213]:
            - generic [ref=f2e214]:
              - heading "Right-of-Way & Orientation" [level=3] [ref=f2e215]
              - generic [ref=f2e220]: Road Access
            - generic [ref=f2e221]:
              - generic [ref=f2e222]:
                - generic [ref=f2e223]: Right-of-Way Width
                - generic [ref=f2e224]:
                  - spinbutton "Right-of-Way Width" [ref=f2e225]: "12"
                  - generic: m
                - paragraph [ref=f2e226]: ">=12m road: High FSI allowed"
              - generic [ref=f2e227]:
                - generic [ref=f2e228]: Road Facing Side
                - generic [ref=f2e229]:
                  - button "N" [ref=f2e230] [cursor=pointer]
                  - button "E" [ref=f2e231] [cursor=pointer]
                  - button "S" [ref=f2e232] [cursor=pointer]
                  - button "W" [ref=f2e233] [cursor=pointer]
                - paragraph [ref=f2e234]: "Facing: North"
        - generic [ref=f2e235]:
          - generic [ref=f2e236]:
            - heading "Statutory Boundary Setbacks (m)" [level=3] [ref=f2e242]
            - generic [ref=f2e243]: NBC / UDCPR Clearance Buffer
          - generic [ref=f2e244]:
            - generic [ref=f2e245]:
              - generic [ref=f2e246]: Front Setback
              - generic [ref=f2e247]:
                - spinbutton "Front Setback" [ref=f2e248]: "3"
                - generic: m
              - paragraph [ref=f2e249]: Clearance to Road Margin
            - generic [ref=f2e250]:
              - generic [ref=f2e251]: Rear Setback
              - generic [ref=f2e252]:
                - spinbutton "Rear Setback" [ref=f2e253]: "2"
                - generic: m
              - paragraph [ref=f2e254]: Clearance to Rear Boundary
            - generic [ref=f2e255]:
              - generic [ref=f2e256]: Side Setbacks (Each Side)
              - generic [ref=f2e257]:
                - spinbutton "Side Setbacks (Each Side)" [ref=f2e258]: "2"
                - generic: m
              - paragraph [ref=f2e259]: Left & Right Side Clearances
          - generic [ref=f2e260]:
            - generic [ref=f2e261]:
              - generic [ref=f2e265]: "Buildable Footprint Envelope:"
              - generic [ref=f2e266]: 26m (W) × 35m (D)
            - generic [ref=f2e267]:
              - generic [ref=f2e268]: "Plinth Footprint:"
              - generic [ref=f2e269]: 910 m² (9,795 sq ft)
              - generic [ref=f2e270]: (76% ground coverage)
      - generic [ref=f2e271]:
        - button "Cancel Setup" [ref=f2e272] [cursor=pointer]
        - button "Continue to Step 02" [ref=f2e278] [cursor=pointer]
```

# Test source

```ts
  18  |     const offset = file.length;
  19  |     file += `${index + 1} 0 obj\n${object}\nendobj\n`;
  20  |     return offset;
  21  |   });
  22  |   const xref = file.length;
  23  |   file += `xref\n0 6\n0000000000 65535 f \n${offsets.map(value => `${String(value).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  24  |   return Buffer.from(file);
  25  | }
  26  | 
  27  | test('welcome renders one scene and scrubs forward and back', async ({ page }, info) => {
  28  |   test.setTimeout(60_000);
  29  |   await page.setViewportSize({ width: 1440, height: 900 });
  30  |   await page.addInitScript(() => {
  31  |     const metrics = { lcp: 0, cls: 0 };
  32  |     Object.assign(window, { rhBrowserMetrics: metrics });
  33  |     new PerformanceObserver(list => {
  34  |       for (const item of list.getEntries()) metrics.lcp = item.startTime;
  35  |     }).observe({ type: 'largest-contentful-paint', buffered: true });
  36  |     new PerformanceObserver(list => {
  37  |       for (const item of list.getEntries() as Array<PerformanceEntry & { hadRecentInput: boolean; value: number }>) {
  38  |         if (!item.hadRecentInput) metrics.cls += item.value;
  39  |       }
  40  |     }).observe({ type: 'layout-shift', buffered: true });
  41  |   });
  42  |   const errors: string[] = [];
  43  |   page.on('pageerror', error => errors.push(error.message));
  44  |   await page.goto(base);
  45  |   const scene = page.getByTestId('cinematic-welcome-canvas-host').locator('canvas');
  46  |   await expect(scene).toBeVisible();
  47  |   const canvas = await scene.elementHandle();
  48  |   await page.screenshot({ path: info.outputPath('01-welcome.png') });
  49  |   const metrics = await page.evaluate(() => (window as Window & { rhBrowserMetrics?: object }).rhBrowserMetrics);
  50  |   console.log('Welcome browser metrics', metrics);
  51  |   await page.getByRole('button', { name: 'Skip intro' }).click();
  52  |   await page.getByTestId('cta-explore-scroll').click();
  53  |   await expect(page.getByTestId('construction-stage-site')).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  54  |   await page.getByTestId('construction-stage-walls').focus();
  55  |   await page.keyboard.press('Enter');
  56  |   await expect(page.getByTestId('construction-stage-walls')).toHaveAttribute('aria-pressed', 'true');
  57  |   await expect(page.getByTestId('welcome-construction-scrubber')).toContainText(/Assembly 5[67]%/);
  58  |   await page.mouse.move(920, 450);
  59  |   await page.mouse.wheel(0, 650);
  60  |   await expect(page.getByTestId('construction-stage-landscape')).toHaveAttribute('aria-pressed', 'true');
  61  |   await page.screenshot({ path: info.outputPath('02-construction.png') });
  62  |   await page.mouse.wheel(0, -530);
  63  |   await expect(page.getByTestId('construction-stage-landscape')).toHaveAttribute('aria-pressed', 'false');
  64  |   await page.getByTestId('construction-stage-site').click();
  65  |   await expect(page.getByTestId('construction-stage-site')).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  66  |   expect(await scene.evaluate((node, original) => node === original, canvas)).toBe(true);
  67  |   expect(errors).toEqual([]);
  68  | });
  69  | 
  70  | test('mobile landing, project entry and redevelopment allocations', async ({ page }, info) => {
  71  |   await page.setViewportSize({ width: 390, height: 844 });
  72  |   await page.emulateMedia({ reducedMotion: 'reduce' });
  73  |   await page.goto(base);
  74  |   await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  75  |   expect(await page.getByTestId('welcome-scroll-container').evaluate(node => node.scrollWidth)).toBeLessThanOrEqual(390);
  76  |   await page.screenshot({ path: info.outputPath('03-mobile-welcome.png') });
  77  |   await page.getByTestId('cta-redevelopment').click();
  78  |   await expect(page.getByTestId('redevelopment-program-panel')).toBeVisible();
  79  |   await page.getByRole('spinbutton', { name: 'Duplex count' }).fill('1');
  80  |   await page.getByRole('spinbutton', { name: 'Triplex count' }).fill('1');
  81  |   await expect(page.getByTestId('redevelopment-feasibility-card')).toBeVisible();
  82  |   await page.screenshot({ path: info.outputPath('04-redevelopment.png') });
  83  |   await page.getByRole('button', { name: 'Continue to Step 02' }).click();
  84  |   await page.getByRole('button', { name: 'Back', exact: true }).click();
  85  |   await expect(page.getByRole('spinbutton', { name: 'Duplex count' })).toHaveValue('1');
  86  |   await expect(page.getByRole('spinbutton', { name: 'Triplex count' })).toHaveValue('1');
  87  |   await page.getByTestId('nav-welcome-home').click();
  88  |   await page.getByTestId('cta-open-existing').click();
  89  |   await expect(page.getByTestId('btn-new-project-from-switcher')).toBeVisible();
  90  | });
  91  | 
  92  | test('production generation, PDF, CAD editing, 3D and verified downloads', async ({ page }, info) => {
  93  |   test.setTimeout(300_000);
  94  |   await page.setViewportSize({ width: 1440, height: 900 });
  95  |   const errors: string[] = [];
  96  |   const failedRequests: string[] = [];
  97  |   page.on('pageerror', error => errors.push(error.message));
  98  |   page.on('response', response => {
  99  |     if (response.status() >= 400 && response.url().startsWith(base)) {
  100 |       failedRequests.push(`${response.status()} ${new URL(response.url()).pathname}`);
  101 |     }
  102 |   });
  103 |   await page.goto(base);
  104 |   await page.getByTestId('cta-new-construction').click();
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
> 118 |   const generation = page.waitForResponse(response => response.url().endsWith('/api/v1/projects/generate'), { timeout: 110_000 });
      |                           ^ TimeoutError: page.waitForResponse: Timeout 110000ms exceeded while waiting for event "response"
  119 |   await page.getByRole('button', { name: 'Generate Architectural Project' }).click();
  120 |   await expect(page.getByRole('dialog', { name: 'Generating your building' })).toBeVisible();
  121 |   await page.screenshot({ path: info.outputPath('07-generation.png') });
  122 |   expect((await generation).status(), 'Production generation route').toBe(200);
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
  145 |   await page.screenshot({ path: info.outputPath('09-assistant.png') });
  146 |   await page.getByRole('button', { name: 'Close assistant' }).click();
  147 |   await page.getByTestId('nav-building_3d').click();
  148 |   await expect(page.getByTestId('building-3d-customizer').locator('canvas').first()).toBeVisible({ timeout: 25000 });
  149 |   await page.getByTestId('floor-mode-isolate').click();
  150 |   await page.locator('[data-testid^="model-level-"]').last().click();
  151 |   await expect(page.locator('[data-testid^="model-level-"]').last()).toHaveAttribute('aria-pressed', 'true');
  152 |   await page.screenshot({ path: info.outputPath('10-building-3d.png') });
  153 |   await page.getByTestId('fixture-opt-casement_timber_win').click();
  154 |   await page.getByTestId('btn-apply-global-skin').click();
  155 |   await expect(page.getByTestId('feedback-notice')).toContainText('Global skin applied');
  156 |   await page.getByRole('button', { name: 'Save project' }).click();
  157 |   await page.setViewportSize({ width: 390, height: 844 });
  158 |   await expect(page.getByTestId('building-3d-customizer').locator('canvas').first()).toBeVisible();
  159 |   await page.screenshot({ path: info.outputPath('11-mobile-3d.png') });
  160 |   await page.setViewportSize({ width: 1440, height: 900 });
  161 |   await page.getByTestId('nav-structural_cad').click();
  162 |   await expect(page.getByText('Professional review required', { exact: true })).toBeVisible();
  163 |   await page.screenshot({ path: info.outputPath('11b-structural-cad.png') });
  164 |   await page.getByTestId('nav-engineering').click();
  165 |   await page.getByRole('tab', { name: 'ETABS Structural Analysis' }).click();
  166 |   await expect(page.getByText('Verified analysis results are unavailable', { exact: false })).toBeVisible();
  167 |   await page.screenshot({ path: info.outputPath('11c-engineering.png') });
  168 |   await page.getByTestId('nav-export').click();
  169 |   await expect(page.getByRole('heading', { name: 'Export Center' })).toBeVisible();
  170 |   await page.screenshot({ path: info.outputPath('12-export.png') });
  171 |   for (const [name, ext, signature] of [
  172 |     ['Download 01 Site Plan pdf', 'pdf', '%PDF-'],
  173 |     ['Download 01 Site Plan dxf', 'dxf', '0'],
  174 |     ['Download 01 Site Plan dwg', 'dwg', 'AC'],
  175 |     ['Download building GLB', 'glb', 'glTF'],
  176 |     ['Download CSI ETABS (.e2k)', 'e2k', ''],
  177 |   ]) {
  178 |     const downloading = page.waitForEvent('download', { timeout: 40_000 });
  179 |     await page.getByRole('button', { name, exact: true }).click();
  180 |     const result = await downloading;
  181 |     expect(result.suggestedFilename()).toMatch(new RegExp(`\\.${ext}$`, 'i'));
  182 |     const path = info.outputPath(result.suggestedFilename());
  183 |     await result.saveAs(path);
  184 |     const bytes = await readFile(path);
  185 |     expect(bytes.length).toBeGreaterThan(30);
  186 |     if (signature) expect(bytes.toString('ascii').trimStart().startsWith(signature)).toBe(true);
  187 |   }
  188 |   const revision = await page.locator('.rh-export-header .rh-kicker').innerText();
  189 |   await page.reload();
  190 |   await page.getByTestId('nav-export').click();
  191 |   await expect(page.locator('.rh-export-header .rh-kicker')).toHaveText(revision);
  192 |   await page.getByTestId('project-switcher-trigger').click();
  193 |   await expect(page.getByTestId('btn-new-project-from-switcher')).toBeVisible();
  194 |   await expect(page.getByTestId('project-switcher-trigger')).toContainText('RH Browser Acceptance');
  195 |   console.log('Failed HTTP responses', failedRequests);
  196 |   expect(errors).toEqual([]);
  197 | });
  198 | 
```