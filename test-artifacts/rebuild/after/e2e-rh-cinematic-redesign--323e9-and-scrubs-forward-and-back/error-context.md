# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e\rh-cinematic-redesign.spec.ts >> welcome renders one scene and scrubs forward and back
- Location: e2e\rh-cinematic-redesign.spec.ts:28:1

# Error details

```
Test timeout of 75000ms exceeded.
```

```
Error: mouse.move: Target page, context or browser has been closed
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - banner:
    - button "RH PLANNER" [ref=e2] [cursor=pointer]
    - navigation "Welcome" [ref=e3]:
      - button "Project library" [ref=e4] [cursor=pointer]
      - button "Start a project" [ref=e7] [cursor=pointer]
  - main [ref=e10]:
    - region "Terrace Residence architectural study" [ref=e11]:
      - generic [ref=e12]:
        - generic:
          - paragraph: The Terrace Residence · Landscape
          - heading "Outdoor rooms in the sky." [level=2]
          - paragraph: Recessed terraces, shaded roofs and the pool extend the living space outside.
        - generic [ref=e15]:
          - generic [ref=e16]: Terrace Residence · Demonstration model
          - generic [ref=e17]:
            - button "Resume tour" [active] [pressed] [ref=e18] [cursor=pointer]
            - button "Switch to evening" [ref=e22] [cursor=pointer]
        - navigation "Architectural views" [ref=e25]:
          - button "Exterior" [ref=e26] [cursor=pointer]
          - button "Site" [ref=e27] [cursor=pointer]
          - button "Section" [ref=e28] [cursor=pointer]
          - button "Plan" [ref=e29] [cursor=pointer]
          - button "Landscape" [pressed] [ref=e30] [cursor=pointer]
    - region "Built architecture references" [ref=e31]:
      - generic [ref=e32]:
        - paragraph [ref=e33]: Built references
        - heading "Spaces beyond the plan." [level=2] [ref=e34]
      - generic [ref=e35]:
        - figure "Arrival sequence Source for Arrival sequence" [ref=e36]:
          - img "Stone and timber screens in a double-height arrival hall" [ref=e37]
          - generic [ref=e38]:
            - text: Arrival sequence
            - link "Source for Arrival sequence" [ref=e39] [cursor=pointer]:
              - /url: https://www.pexels.com/photo/8312027/
              - text: ↗
        - figure "Living spaces Source for Living spaces" [ref=e40]:
          - img "Contemporary living room with warm wood finishes and city views" [ref=e41]
          - generic [ref=e42]:
            - text: Living spaces
            - link "Source for Living spaces" [ref=e43] [cursor=pointer]:
              - /url: https://www.pexels.com/photo/29515355/
              - text: ↗
        - figure "Glazed balconies Source for Glazed balconies" [ref=e44]:
          - img "Curved balconies with timber soffits on a residential building in Dubai" [ref=e45]
          - generic [ref=e46]:
            - text: Glazed balconies
            - link "Source for Glazed balconies" [ref=e47] [cursor=pointer]:
              - /url: https://www.pexels.com/photo/29174529/
              - text: ↗
        - figure "Rooftop amenity Source for Rooftop amenity" [ref=e48]:
          - img "Infinity pool above a city skyline at dusk" [ref=e49]
          - generic [ref=e50]:
            - text: Rooftop amenity
            - link "Source for Rooftop amenity" [ref=e51] [cursor=pointer]:
              - /url: https://www.pexels.com/photo/5339086/
              - text: ↗
    - region "How are you building?" [ref=e52]:
      - generic [ref=e53]:
        - heading "How are you building?" [level=2] [ref=e54]
        - button "Open existing project" [ref=e55] [cursor=pointer]
      - generic [ref=e58]:
        - button "New construction Define the parcel, program and apartment mix." [ref=e59] [cursor=pointer]:
          - generic [ref=e60]:
            - strong [ref=e61]: New construction
            - generic [ref=e62]: Define the parcel, program and apartment mix.
        - button "Redevelopment Record the existing building, retained areas and owner requirements." [ref=e65] [cursor=pointer]:
          - generic [ref=e66]:
            - strong [ref=e67]: Redevelopment
            - generic [ref=e68]: Record the existing building, retained areas and owner requirements.
```

# Test source

```ts
  1   | import { expect, test } from '@playwright/test';
  2   | import { readFile } from 'node:fs/promises';
  3   | 
  4   | const base = process.env.RH_CINEMATIC_URL ?? 'http://127.0.0.1:4177';
  5   | test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } });
  6   | 
  7   | function surveyPdf() {
  8   |   const drawing = '0.2 0.2 0.2 RG 1 w 60 100 240 320 re S BT /F1 12 Tf 64 430 Td (Survey plot - 30 m x 40 m) Tj ET';
  9   |   const objects = [
  10  |     '<< /Type /Catalog /Pages 2 0 R >>',
  11  |     '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
  12  |     '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
  13  |     `<< /Length ${drawing.length} >>\nstream\n${drawing}\nendstream`,
  14  |     '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  15  |   ];
  16  |   let file = '%PDF-1.4\n';
  17  |   const offsets = objects.map((object, index) => {
  18  |     const offset = file.length;
  19  |     file += `${index + 1} 0 obj\n${object}\nendobj\n`;
  20  |     return offset;
  21  |   });
  22  |   const xref = file.length;
  23  |   file += `xref\n0 6\n0000000000 65535 f \n${offsets.map(value => `${String(value).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  24  |   return Buffer.from(file);
  25  | }
  26  | 
  27  | 
  28  | test('welcome renders one scene and scrubs forward and back', async ({ page }, info) => {
  29  |   test.setTimeout(75_000);
  30  |   await page.setViewportSize({ width: 1280, height: 800 });
  31  |   await page.addInitScript(() => {
  32  |     const metrics = { lcp: 0, cls: 0 };
  33  |     Object.assign(window, { rhBrowserMetrics: metrics });
  34  |     new PerformanceObserver(list => {
  35  |       for (const item of list.getEntries()) metrics.lcp = item.startTime;
  36  |     }).observe({ type: 'largest-contentful-paint', buffered: true });
  37  |     new PerformanceObserver(list => {
  38  |       for (const item of list.getEntries() as Array<PerformanceEntry & { hadRecentInput: boolean; value: number }>) {
  39  |         if (!item.hadRecentInput) metrics.cls += item.value;
  40  |       }
  41  |     }).observe({ type: 'layout-shift', buffered: true });
  42  |   });
  43  |   const errors: string[] = [];
  44  |   page.on('pageerror', error => errors.push(error.message));
  45  |   await page.goto(base);
  46  |   const scene = page.getByTestId('residence-showcase');
  47  |   const canvas = scene.locator('canvas');
  48  |   await expect(scene).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });
  49  |   await expect(canvas).toBeVisible();
  50  |   const original = await canvas.elementHandle();
  51  |   await page.screenshot({ path: info.outputPath('01-welcome.png') });
  52  |   const metrics = await page.evaluate(() => (window as Window & { rhBrowserMetrics?: object }).rhBrowserMetrics);
  53  |   console.log('Welcome browser metrics', metrics);
  54  | 
  55  |   await page.getByTestId('cta-explore-scroll').click();
  56  |   const views = page.getByRole('navigation', { name: 'Architectural views' });
  57  |   const site = views.getByRole('button', { name: 'Site', exact: true });
  58  |   await expect(site).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  59  |   await expect.poll(async () => Number(await scene.getAttribute('data-progress')), { timeout: 10_000 }).toBeGreaterThan(.22);
  60  |   await page.mouse.move(850, 395);
  61  |   await page.mouse.wheel(0, 570);
  62  |   const section = views.getByRole('button', { name: 'Section', exact: true });
  63  |   await expect(section).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  64  |   await expect.poll(async () => Number(await scene.getAttribute('data-progress'))).toBeGreaterThan(.43);
  65  |   await page.screenshot({ path: info.outputPath('02-section.png') });
  66  | 
  67  |   await page.mouse.wheel(0, -550);
  68  |   await expect(site).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  69  |   await expect.poll(async () => Number(await scene.getAttribute('data-progress'))).toBeLessThan(.33);
  70  |   await views.getByRole('button', { name: 'Landscape', exact: true }).click();
  71  |   await expect(views.getByRole('button', { name: 'Landscape', exact: true })).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  72  |   await expect.poll(async () => Number(await scene.getAttribute('data-progress')), { timeout: 10_000 }).toBeGreaterThan(.88);
  73  |   await page.screenshot({ path: info.outputPath('02b-landscape.png') });
  74  |   expect(await canvas.evaluate((node, previous) => node === previous, original)).toBe(true);
  75  | 
  76  |   await page.getByRole('button', { name: 'Orbit model' }).click();
  77  |   const orbit = page.getByRole('button', { name: 'Resume tour' });
  78  |   await expect(orbit).toHaveAttribute('aria-pressed', 'true');
  79  |   await page.mouse.move(830, 400);
  80  |   await page.mouse.down();
> 81  |   await page.mouse.move(950, 430, { steps: 8 });
      |                    ^ Error: mouse.move: Target page, context or browser has been closed
  82  |   await page.mouse.up();
  83  |   await page.getByTestId('welcome-theme-toggle').click();
  84  |   await expect(page.getByTestId('welcome-theme-toggle')).toHaveAccessibleName('Switch to daylight');
  85  |   await page.getByRole('button', { name: 'Resume tour' }).click();
  86  | 
  87  |   const gallery = page.getByRole('region', { name: 'Built architecture references' });
  88  |   await gallery.scrollIntoViewIfNeeded();
  89  |   await gallery.locator('img').evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())));
  90  |   await gallery.screenshot({ path: info.outputPath('02c-built-references.png') });
  91  |   await page.getByRole('heading', { name: 'How are you building?' }).scrollIntoViewIfNeeded();
  92  |   await page.locator('.rh-atelier-choices').screenshot({ path: info.outputPath('02d-project-entry.png') });
  93  |   expect(errors).toEqual([]);
  94  |   await page.getByTestId('cta-new-construction').click();
  95  |   await expect(canvas).toHaveCount(0);
  96  | });
  97  | 
  98  | test('mobile landing, project entry and redevelopment allocations', async ({ page }, info) => {
  99  |   test.setTimeout(60_000);
  100 |   await page.setViewportSize({ width: 390, height: 844 });
  101 |   await page.emulateMedia({ reducedMotion: 'reduce' });
  102 |   await page.goto(base);
  103 |   await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  104 |   expect(await page.getByTestId('welcome-scroll-container').evaluate(node => node.scrollWidth)).toBeLessThanOrEqual(390);
  105 |   await page.screenshot({ path: info.outputPath('03-mobile-welcome.png') });
  106 |   await page.getByTestId('cta-redevelopment').click();
  107 |   await expect(page.getByTestId('redevelopment-program-panel')).toBeVisible();
  108 |   await page.getByRole('button', { name: 'Existing', exact: true }).click();
  109 |   await expect(page.getByRole('button', { name: 'Existing', exact: true })).toHaveAttribute('aria-pressed', 'true');
  110 |   await page.getByRole('button', { name: 'Proposed', exact: true }).click();
  111 |   await page.getByRole('spinbutton', { name: 'Duplex count' }).fill('1');
  112 |   await page.getByRole('spinbutton', { name: 'Triplex count' }).fill('1');
  113 |   await expect(page.getByTestId('redevelopment-feasibility-card')).toBeVisible();
  114 |   await page.getByTestId('redevelopment-program-panel').scrollIntoViewIfNeeded();
  115 |   await page.screenshot({ path: info.outputPath('04-redevelopment.png') });
  116 |   await page.getByRole('button', { name: 'Continue to Step 02' }).click();
  117 |   await expect(page.getByRole('heading', { name: 'Floors and parking' })).toBeVisible();
  118 |   await page.screenshot({ path: info.outputPath('04b-mobile-floors.png') });
  119 |   await page.getByRole('button', { name: 'Back', exact: true }).click();
  120 |   await expect(page.getByRole('spinbutton', { name: 'Duplex count' })).toHaveValue('1');
  121 |   await expect(page.getByRole('spinbutton', { name: 'Triplex count' })).toHaveValue('1');
  122 |   await page.getByTestId('nav-welcome-home').click();
  123 |   await page.getByTestId('cta-open-existing').click();
  124 |   await expect(page.getByRole('heading', { name: 'Project library' })).toBeVisible();
  125 |   await expect(page.getByTestId('btn-new-project-from-switcher')).toBeVisible();
  126 | });
  127 | 
  128 | test('welcome keeps project entry usable when WebGL is unavailable', async ({ page }, info) => {
  129 |   await page.setViewportSize({ width: 390, height: 844 });
  130 |   await page.addInitScript(() => {
  131 |     const getContext = HTMLCanvasElement.prototype.getContext;
  132 |     HTMLCanvasElement.prototype.getContext = function (kind: string, ...options: unknown[]) {
  133 |       return kind.startsWith('webgl') ? null : Reflect.apply(getContext, this, [kind, ...options]);
  134 |     } as typeof getContext;
  135 |   });
  136 |   await page.goto(base);
  137 |   await expect(page.getByTestId('residence-showcase')).toHaveAttribute('data-status', 'unavailable');
  138 |   await expect(page.getByText('Reference photograph · 3D unavailable')).toBeVisible();
  139 |   await expect(page.getByRole('button', { name: 'Orbit model' })).toBeHidden();
  140 |   await page.locator('.rh-atelier-fallback').evaluate((photo: HTMLImageElement) => photo.decode());
  141 |   await page.screenshot({ path: info.outputPath('03b-mobile-webgl-fallback.png') });
  142 |   await page.getByRole('button', { name: 'Start a project' }).click();
  143 |   await page.getByTestId('cta-new-construction').click();
  144 |   await expect(page.getByRole('heading', { name: 'Project type and site' })).toBeVisible();
  145 | });
  146 | 
  147 | test('production generation, PDF, CAD editing, 3D and verified downloads', async ({ page }, info) => {
  148 |   test.setTimeout(300_000);
  149 |   await page.setViewportSize({ width: 1440, height: 900 });
  150 |   const errors: string[] = [];
  151 |   const failedRequests: string[] = [];
  152 |   page.on('pageerror', error => errors.push(error.message));
  153 |   page.on('response', response => {
  154 |     if (response.status() >= 400 && response.url().startsWith(base)) {
  155 |       failedRequests.push(`${response.status()} ${new URL(response.url()).pathname}`);
  156 |     }
  157 |   });
  158 |   await page.goto(base);
  159 |   await page.getByTestId('cta-new-construction').click();
  160 |   await page.getByLabel('Project Title / Estate', { exact: false }).fill('RH Browser Acceptance');
  161 |   const plot = page.getByTestId('parcel-study');
  162 |   const drawing = plot.getByRole('img', { name: /Schematic/ });
  163 |   const frontage = page.getByLabel('Frontage (Width W)', { exact: false });
  164 |   const originalFrontage = await frontage.inputValue();
  165 |   await frontage.fill('33');
  166 |   await expect(drawing).toHaveAccessibleName(/Schematic 33 by/);
  167 |   const shape = plot.locator('polygon').first();
  168 |   const points = await shape.getAttribute('points');
  169 |   await plot.getByRole('button', { name: 'Rotate plot right' }).click();
  170 |   await expect(shape).not.toHaveAttribute('points', points!);
  171 |   await frontage.fill(originalFrontage);
  172 |   await page.screenshot({ path: info.outputPath('05-project-setup.png') });
  173 |   for (const step of [2, 3, 4]) {
  174 |     await page.getByRole('button', { name: `Continue to Step 0${step}` }).click();
  175 |     if (step !== 4) await page.screenshot({ path: info.outputPath(`05-setup-step-${step}.png`) });
  176 |   }
  177 |   const prompt = page.getByPlaceholder('Describe room layout preferences', { exact: false });
  178 |   await prompt.fill('Prioritize natural light in the living rooms and separate private bedrooms from entry circulation.');
  179 |   const fileInput = page.locator('input[type=file]').first();
  180 |   await fileInput.setInputFiles({ name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('invalid') });
  181 |   await expect(page.getByText('The selected file does not have a valid PDF signature.')).toBeVisible();
```