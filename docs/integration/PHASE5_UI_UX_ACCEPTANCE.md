# Phase 5 Architectural UI/UX, 3D Realism & Structural Workflow Acceptance (Gates L, M & N)

## 1. Gate L — Architectural UI/UX and connected controls
- **4-Mode Studio Workflow Navigation (`ArgonStudioShell.tsx`):**
  - Grouped workspaces into four clear architectural workflow phases: **Design** (`Brief`, `Massing`, `Floor 3D`, `Tower 3D`), **Drafting** (`2D CAD`, `Edit Plan`), **BIM Coordination** (`BIM Studio`, `Compliance`, `Exports`), and **Structural** (`Structural`), accompanied by a live `topbar-canonical-sync-pill` (`Rev #N · Storey · Selection`) and `FT / M` unit toggle.
- **Warm-Beige Architectural Paper & Obsidian Themes + Reduced Motion (`rh-obsidian-neon.css`):**
  - Added `[data-studio-surface="warm-paper"]` (`#F5EFE6` travertine paper, `#221D18` espresso ink, `#8B6843` brushed bronze) toggleable via `studio-surface-theme-toggle` alongside Obsidian mode, plus full `@media (prefers-reduced-motion: reduce)` transition/animation suppression.
- **Zero Decorative / Placeholder Controls (`Building3DCustomizer.tsx`):**
  - Removed the legacy disabled `"3D PBR Furniture Library scheduled for Phase 8 (preview only)"` cards and wired all 6 furniture controls (`bed_master`, `sofa_living`, `dining_set`, `wardrobe_full`, `kitchen_modular`, `bath_fixtures`) + `Cutaway View` directly to live per-category Three.js furniture groups in `ModelWorkspace.tsx` and `ThreeBuildingScene.tsx`.

## 2. Gate M — Professional 3D Visualization
- **Accurate Heights & Realism:** Renders non-foggy ACES-filmic daylight/golden/night illumination, `1,050–1,100 mm` balcony parapets/balustrades, open stilt parking bays, double-height sky-deck coordination, section cutaway planes, walkthrough mode, and clearance-safe interior furniture (including flush `550 mm` perimeterbedroom wardrobes).
- **Selection & GPU Discipline:** Highlights selected `room`, `wall`, `door`, and `window` canonical entities without rebuilding merged static floor geometry (`maxPerFrame <= 1` during orbit), disposes GPU buffers/materials on unmount and project switches, and recovers cleanly across 5 consecutive WebGL context loss/restore cycles.

## 3. Gate N — Architecture-First Structural Workflow
- **Clean Separation of Disciplines:** Architectural floor-plan generation and default architectural PDF/DXF/DWG exports (`includeStructural: false`) keep structural centerlines off architectural sheets by default.
- **Provisional Framing & PE Boundary:** `StructuralCADWorkspace.tsx` operates strictly downstream of the approved architectural layout, labeling generated RCC column/beam concepts as provisional (`IS 456:2000 & IS 1893:2016 — Professional PE Review Required`) with dedicated structural drawings and ETABS `.e2k` analytical exports.

## Independent review

Layer visibility and day/night transitions were exercised in production Chromium. Furniture placement editing is scoped to canonical items in rooms with straight orthogonal walls. The editor checks the footprint, door clearance, neighboring items and modeled columns. This is a bounded placement check. The complete control inventory, visual review of all design cases, physical lighting analysis and native structural verification remain open.

Leaving Welcome while Three.js was compiling shaders raised an uncaught error on the hardware Chromium replay. The welcome scene now compiles its first frame on its own cancellable animation callback. The pending-shader browser regression and the complete hardware studio workflow both passed twice.

A supplemental Windows Chromium replay exercised the current camera preset names, forward and backward wheel scrubbing, free orbit, night lighting, credits links and Studio entry on a single canvas. The legacy cinematic test still references retired button names. The production repair suite covers the actual current Studio entry and the shader teardown regression.
