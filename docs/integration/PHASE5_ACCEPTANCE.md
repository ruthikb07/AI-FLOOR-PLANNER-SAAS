# Phase 5 acceptance

**Status: NOT READY.**

Phase 5A and 5B were recovered with their local commits and Phase 5C source. The recovered Phase 5A suite passed 14/14. Phase 5B and Phase 4B backend acceptance passed 12/12, and the production HTTP project matrix passed 9/9. Local IfcOpenShell readback covered twelve profile fixtures and eight additional project exports. Native desktop IFC application reopen is unverified.

| Gate | Disposition |
| --- | --- |
| Protected regeneration | Full protected room, unit, wall, opening, furniture and structural comparisons cover supported local scopes. Exact re-hosting restrictions and split-line geometry remain part of the protected acceptance path. |
| Direct CAD and persistence | CAD refuses missing or ambiguous targets. Runtime input checks and compare-and-save are covered by targeted regressions. The disk archive sequence is independent of the accepted Building revision. |
| Unified Studio | Windows production Chromium verified local Flat 2 regeneration, undo and redo, BIM-to-Precision-CAD selection, Tower 3D highlighting and disk save and reload. Export provenance across all requested formats and the full control inventory remain open. |
| 3D and furniture | Layer visibility and decorative lighting are exercised in Chromium. Manual furniture placement uses checked canonical edits on supported orthogonal rooms. Two isolated Windows SwiftShader workflow runs passed, and five real WebGL contexts recovered automatically on the updated renderer. Hardware-GPU coverage remains open. |
| AI and BIM | Typed factual results, controlled edit proposals, scoped clearance and read-only reference support. General external IFC geometry, BCF and live Gemini replay remain outside the verified evidence. |
| Nine real projects | Nine production HTTP checks passed. Eight accepted projects were saved, read back, exported to IFC and GLB, and visually reviewed in Chromium. The full browser matrix, exact surveyed intake, image influence and native format coverage across the matrix remain open. |
| Structural | Separate structural workspace and model exchange preserve the architecture-first workflow. Professional review required. |
| Independent CI | The code checkpoint `3269d7890cd57683d3cd5eee3f5fa31ec27b739a` passed build, typecheck, lint, package units, integration, Chromium, the separate 288-case planning benchmark and independent IFC4 readback. [GitHub Actions run 45632194196](https://github.com/ruthikb07/AI-FLOOR-PLANNER-SAAS/actions/runs/45632194196) |

[Engineering handoff](../repair/PHASE5_CODEX_HANDOFF.md) · [Project matrix](PHASE5_REAL_PROJECT_ACCEPTANCE.md) · [Performance evidence](PHASE5_PERFORMANCE_REPORT.md)

Windows native AutoCAD completed twelve zero-error audits. A native Blender 5.2 package produced and verified seven files, including the complete `.blend` assembly and GLBs with canonical provenance. Native ETABS 23.3.2 replay reached the existing bridge and returned `TRANSPORT_ERROR` at connect. The bridge reported an unknown native outcome, and the replay ended before EDB reopen.
