# RH Planner repair context

The repair starts at origin/main commit `1e0d1fefd87e8550b648e1c62732c5e5c7cf24ce` (merge of release/local-studio-verified). Work is in the separate `repair/stabilize-rh-planner` worktree. The original checkout was on `feat/nextgen-solver-and-exports` with two uncommitted component edits.

Local verification used Windows, Node 24.18.0 and pnpm 9.7.0. GitHub Actions targets Ubuntu with Node 22 and the repository-pinned pnpm version. The baseline and final commands are recorded in [the defect ledger](DEFECT_LEDGER.md) and [the phase handoff](PHASE_HANDOFF.md).

## Dependency map

| Boundary | Source path and downstream contracts |
| --- | --- |
| Backend access | `packages/backend/src/server.ts` mounts request access and input guards before the generation, architecture evaluation, CAD import, local-project and export routes. Route services own disk reads, atomic writes, artifact verification and native integrations. |
| Planning | `ArgonStudioShell` → `argon-request` → `argon-generation` and the planning worker → backend generation or deterministic local audited pipeline → `constraint-engine/generation-acceptance` → canonical editor. CAD plot generation uses the same acceptance rule. |
| Acceptance | The audited planning pipeline checks canonical geometry and apartment closure. The constraint gate considers the building schema, audit validity, uncorrected critical geometry, closure and required opening findings. The worker also audits the canonical model returned by the HTTP endpoint. Regulatory and professional review remain separate. |
| Identity and editor | `Building.projectId`, `Building.id` and floor ownership stay stable during regeneration. `Building.version` identifies the accepted revision. `metadata.generationRunId` identifies each solver run. A full replacement uses an undoable command and preserves the audited geometry snapshot. |
| Browser storage | `main.tsx` → `hydrateProjectStorage` → `IndexedDbProjectStore` → editor autosave/manual retry and browser revision archive. IndexedDB v2 keeps the existing `projects` store and adds `projectRevisions`. |
| AI orchestration | `generation-routes.ts` & `cad-edit-routes.ts` → `GeminiProvider` (compact text vs vision JSON schema, capability-aware `FAST` / `BALANCED` / `DEEP` reasoning budgets, single `totalDeadlineMs` budget, `maxTotalAttempts`, per-model `429`/`503`/`TIMEOUT` cooldowns, immediate halt on project-wide `429` or `401/403` auth errors, `redactSecret`, 18-dimension SHA-256 `BoundedLruCache` + cancellation-isolated `InFlightRequestDeduplicator`) → `interpretStructuredBriefRequirements` & `classifyReferenceAttachment` → deterministic `planning-engine` / `proposeControlledCadEdit`. End-to-end cancellation (`AbortController`) propagates across worker, HTTP disconnect, and route boundaries (`HTTP 499 REQUEST_CANCELLED` before geometry synthesis). |
| Canonical CAD interchange | `core/interchange/{cota-cad-kernel,canonical-cad-adapter}.ts` (`CanonicalDxfExchangeAdapter`, `EXCHANGE_FRAME` `(x, -y, elevationMm)` in `mm`, `RH_CANONICAL` XDATA handles) ↔ `PrecisionCadWorkbench.tsx` (lazy-loaded in `ArchitecturalCADWorkspace.tsx`) ↔ `EditorEngine` Undo/Redo & verified `CadExportService` (`AC1032` DWG/DXF). |
| Verification | Root pnpm/Turbo package scripts (`build`, `typecheck`, `lint`, `test`), the Vitest integration suites, production-backend/Chromium Playwright repair & WebGL recovery configs, `.github/workflows/verification.yml` (`main`, `repair/**`, `fix/**`, `feat/**`, `feature/**`, PRs, manual dispatch), and `.github/workflows/opt-in-live-verification.yml`. |

## Deployment and persistence contracts

- Default backend and Vite dev listener bind to `127.0.0.1`. The default profile authorizes the local operator using the TCP peer, Host and browser origin/fetch context. Vite proxies the same-origin API. The loopback profile grants access to the single local project and artifact library.
- For private hosted use, configure `RH_API_HOST`, `RH_API_TOKEN` (at least 32 printable non-space characters), and any exact browser origins in `RH_API_ALLOWED_ORIGINS`. All general API clients need the bearer token in this profile, including connections from reverse proxies. Keep it at an authenticated gateway or in server-side/CLI configuration. Isolate storage per deployment. Native ETABS retains its own local-only token and origin requirements.
- An HTTP 422 with `GENERATION_CHECKS_FAILED` carries blocker findings and no accepted building. The editor keeps its existing project open. Existing imported and saved projects remain accessible for repair.
- Browser regeneration archives the previous project envelope before replacing the current model. The Project Library exposes archived envelopes as JSON. If the archive write fails, the current model remains active. A failed normal browser save keeps the current model in memory and offers retry and JSON export.
- The migration deletes a legacy localStorage copy only after matching IndexedDB readback. Differing legacy bytes remain available even when the durable copy is active. Raw source CAD uploads are retained per project for the current session until a successful disk save.
