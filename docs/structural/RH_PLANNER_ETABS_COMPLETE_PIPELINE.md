# RH Planner ETABS pipeline — source audit and blocking conflict

Audit date: 2026-11-11. **ETABS STRUCTURAL PIPELINE NOT VERIFIED**.

## Stop condition

`AGENTS.md:39` states: "Repository reality overrides handoff summaries. If instructions conflict with actual code, types or tests, stop and report the conflict. Do not silently force the repository to match a summary."

The drawings/report handoff describes FEM results, native analysis evidence, drift checks and member design results. The current implementation contradicts those claims. Implementation stopped at this audit; no application code, frontend files or existing artifacts were modified.

## Observed implementation

- The existing C# OAPI connector, structural transfer adapter, TypeScript export service, comparison service and opt-in native tests exist. They should be reused.
- `StructuralModelTransfer.cs` writes project/building/revision metadata and reads load-pattern names and self-weight multipliers. Their correctness after native reopen has NOT been tested in this run.
- `structural-analysis-engine.ts` does not call ETABS. It assigns fixed tributary area, loads, material grades and reinforcement; computes support shears/moments from column indices; synthesizes drift using a sine function; assumes seismic zone, soil, importance and response factors; and returns SAFE/PASS statuses.
- `artifact-registry.ts` and `structural-drawings-service.ts` consume that engine. Thus the issue affects exported artifacts, not just an unused example.
- M30/M25 concrete, Fe500 steel, 200 kPa soil bearing pressure, medium soil, Z=0.16, I=1.2 and R=5 in that engine are not verified project inputs. This audit does not approve those assumptions or validate its equations.
- `ETABS_EDB_EXPORT_HANDOFF.md` was not present in the structural documentation directory.

## Environment and native evidence

- `D:\ETABS.exe` exists; file/product version read directly: **23.3.2.4670**.
- `D:\ETABSv1.dll` exists.
- The previously documented private SDK executable at `%LOCALAPPDATA%\RHPlanner\dotnet-sdk\dotnet.exe` was absent at audit time. Other SDK locations were not investigated before the stop condition.
- ETABS startup, licensing, native save/reopen, analysis, material readback and result retrieval were not executed in this run. Historical handoff assertions are not fresh verification.
- No load cases, design checks, screenshot evidence, PDF numerical results or native EDB downloads were verified in this run.
- No new EDB, PDF, CAD or screenshot artifacts were produced. Historical artifact paths in other handoffs remain unverified here.

## Remaining checkpoints

1. Resolve the source/handoff conflict explicitly: retain the native connector and replace or quarantine synthetic analysis output so it cannot be presented as native engineering evidence.
2. Complete checkpoint A: build the existing bridge; test persisted architectural revision, load-pattern readback, independent native reopen and full model comparison using both distinct structural fixtures. Do not advance past failures.
3. Implement reviewed structural geometry and material assignments with actual reopened property verification.
4. Establish approved, versioned load inputs and independently verified code references; do not infer missing occupancy/site/soil parameters.
5. Run native analysis and retrieve traceable results, stability warnings and equilibrium checks; implement supervised design separately.
6. Capture real native graphical evidence per run/case, recording failures rather than substituting illustrations.
7. Generate reports and drawings exclusively from traceable approved geometry/results; verify PDFs and all artifact downloads.
8. Exercise the complete pipeline on multiple distinct projects and record focused/package/full tests, typecheck, lint and diff review.

## Validation and working tree

This run performed read-only source inspection, git status inspection and executable version/path checks. Software tests were not run; no test PASS or engineering validation is claimed.

The initial working tree contained extensive modified and untracked files across backend, core, frontend, planning, geometry, rendering, documentation and generated artifacts. Those changes were preserved. This run adds only this report. No reset, clean, commit, push or merge was performed.

Final verdict: **ETABS STRUCTURAL PIPELINE NOT VERIFIED**. This is a stop-condition audit, not completion of the requested implementation.
