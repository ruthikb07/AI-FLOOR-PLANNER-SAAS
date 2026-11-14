# RH Planner — Dead-Weight & Orphaned Code Removal Log (Phase 1)

**Date:** 2026-11-14  
**Scope:** Monorepo (`packages/*`, `tools/*`, repository root)  
**Verification Method:** Static cross-reference check across all `.ts`, `.tsx`, `.js`, and `.json` files followed by `pnpm typecheck` and `pnpm build`.

---

## 1. Deleted Orphaned Source Files & Root Scripts

| File Path | Category | Verification Result | Reason for Removal |
| :--- | :--- | :--- | :--- |
| `RH_PLANNER_CINEMATIC_WORKFLOW.js` | Orphaned Root Script | 0 imports | Unreferenced pseudo-script with undefined `agent()` calls and duplicate keys (`defaults`) left over from an external script experiment. |
| `packages/frontend/src/components/wizard/NewApartmentWizard.tsx` | Pre-Argon UI Component | 0 references in `packages/` | Replaced by `ArgonStudioShell` + `ProjectSetupWizard` (`Stage1PlotAndSetbacks`..`Stage4PromptAndUpload`). |
| `packages/frontend/src/components/modals/ExportModal.tsx` | Pre-Argon UI Component | 0 references in `packages/` | Replaced by `ExportCenterWorkspace`. |
| `packages/frontend/src/components/budget/BuildingBudgetWorkspace.tsx` | Pre-Argon UI Component | 0 references in `packages/` | Superseded pre-Argon budget workspace view not reachable from `App.tsx` or `ArgonStudioShell.tsx`. |
| `packages/frontend/src/components/diagnostics/DesignDiagnosticsPanel.tsx` | Pre-Argon UI Component | 0 references in `packages/` | Superseded diagnostics panel not reachable from `ArgonStudioShell.tsx`. |
| `packages/frontend/src/components/footprint/FootprintWorkspace.tsx` | Pre-Argon UI Component | 0 references in `packages/` | Superseded footprint workspace not reachable from `ArgonStudioShell.tsx`. |
| `packages/frontend/src/components/layout/StatusBar.tsx` | Pre-Argon UI Component | 0 references in `packages/` | Superseded legacy layout chrome not used by Argon Studio. |
| `packages/frontend/src/components/layout/ToolPalette.tsx` | Pre-Argon UI Component | 0 references in `packages/` | Superseded legacy CAD tool palette not used by `ArchitecturalCADWorkspace`. |
| `packages/frontend/src/components/program/ProgramWorkspace.tsx` | Pre-Argon UI Component | 0 references in `packages/` | Superseded space-program workspace not reachable from `ArgonStudioShell.tsx`. |
| `packages/frontend/src/components/projects/ProjectDashboard.tsx` | Pre-Argon UI Component | 0 references in `packages/` | Superseded legacy dashboard replaced by `RHWelcomeScreen`. |
| `packages/frontend/src/components/site/SiteWorkspace.tsx` | Pre-Argon UI Component | 0 references in `packages/` | Superseded site workspace; site plan is integrated into coordinated sheet `A-101`. |

Empty component subdirectories removed after deleting the legacy files:
- `packages/frontend/src/components/wizard`
- `packages/frontend/src/components/budget`
- `packages/frontend/src/components/diagnostics`
- `packages/frontend/src/components/footprint`
- `packages/frontend/src/components/layout`
- `packages/frontend/src/components/program`
- `packages/frontend/src/components/projects`
- `packages/frontend/src/components/site`

---

## 2. Deleted Root Diagnostic Log Artifacts (114 files)

Removed stale build/test capture logs from the repository root (`etabs-*.log`, `p1-*.log`, `phase0-*.log`, `phase1-*.log`, `phase2-*.log`, `phase25-*.log`, `phase26-*.log`, `phase5-*.log`, `stage6-*.log`):
- `etabs-backend-build.log`, `etabs-native-verified.log`, `etabs-p31-native.log`, `etabs-p31-types.log`, `etabs-p31-unit.log`, `etabs-types-build.log`
- `p1-browser-server.log`, `p1-build.log`, `p1-final-build.log`, `p1-final-lint.log`, `p1-final-test.log`, `p1-final-typecheck.log`, `p1-focused.log`, `p1-full-test.log`, `p1-generation-focused.log`, `p1-generation-last.log`, `p1-lint.log`, `p1-phase1-focused.log`, `p1-release-build.log`, `p1-release-lint.log`, `p1-release-test.log`, `p1-release-typecheck.log`, `p1-test-file-lock.log`, `p1-test-forks-file-lock.log`, `p1-test-worker-crash.log`, `p1-typecheck.log`, `p1-typecheck-initial.log`, `p1-verified-build.log`, `p1-verified-lint.log`, `p1-verified-test.log`, `p1-verified-typecheck.log`
- `phase0-plancraft-tests.log`, `phase0-remaining-tests.log`, `phase0-test.log`, `phase0-typecheck.log`
- `phase1-all-tests.log`, `phase1-backend.log`, `phase1-build.log`, `phase1-debug.log`, `phase1-final-build.log`, `phase1-final-lint.log`, `phase1-final-test.log`, `phase1-final-typecheck.log`, `phase1-focus.log`, `phase1-frontend.log`, `phase1-install.log`, `phase1-lint.log`, `phase1-new-tests.log`, `phase1-planning.log`, `phase1-recheck-build.log`, `phase1-recheck-planning.log`, `phase1-recheck-typecheck.log`, `phase1-reopen.log`, `phase1-small.log`, `phase1-snapper.log`, `phase1-type.log`, `phase1-typecheck.log`, `phase1-vite.log`
- `phase25-build.log`, `phase25-build-verified.log`, `phase25-engine-green.log`, `phase25-engine-red.log`, `phase25-export.log`, `phase25-export-verified.log`, `phase25-final-build.log`, `phase25-final-build-retry.log`, `phase25-final-lint.log`, `phase25-final-test.log`, `phase25-final-typecheck.log`, `phase25-final-typecheck-retry.log`, `phase25-final-unit.log`, `phase25-frontend-final-build.log`, `phase25-frontend-final-lint.log`, `phase25-frontend-final-typecheck.log`, `phase25-full-test.log`, `phase25-integration.log`, `phase25-lint.log`, `phase25-lint-verified.log`, `phase25-typecheck.log`, `phase25-typecheck-verified.log`, `phase25-ui-green.log`, `phase25-ui-red.log`, `phase25-unit.log`, `phase25-unit-serial.log`
- `phase26-build.log`, `phase26-contract-test.log`, `phase26-integration.log`, `phase26-lint.log`, `phase26-real-building.log`, `phase26-test.log`, `phase26-typecheck.log`, `phase26-unit.log`
- `phase2-artifacts-check.log`, `phase2-backend-check.log`, `phase2-cad-ui-check.log`, `phase2-focused.log`, `phase2-frontend-check.log`, `phase2-renderer-check.log`, `phase2-ui-check.log`
- `phase5-backend.log`, `phase5-focused.log`, `phase5-full-suite.log`, `phase5-full-suite-final.log`, `phase5-lint.log`, `phase5-native-inspection.log`, `phase5-projection.log`, `phase5-typecheck.log`
- `stage6-baseline-frontend.log`, `stage6-baseline-lint.log`, `stage6-baseline-lint-retry.log`, `stage6-baseline-test.log`, `stage6-baseline-typecheck.log`, `stage6-reconciled-baseline.log`, `stage6-reconciliation-focused.log`

---

## 3. Metadata & Cloudflare/FLUX Cleanup

- Updated `packages/backend/package.json` `"description"` to remove obsolete `(Cloudflare FLUX)` copy and accurately reflect Gemini architectural generation, vision/evaluation proxies, and deterministic CAD/PDF/3D/ETABS export services.

---

## 4. Guardrails Preserved

- All shared TypeScript interfaces (`@ai-floor-planner/core`), geometry (`@ai-floor-planner/geometry-engine`), constraints (`@ai-floor-planner/constraint-engine`), Plancraft DSL, ETABS bridge sources, test fixtures, and `docs/RH_*.md` deliverables were preserved intact.

