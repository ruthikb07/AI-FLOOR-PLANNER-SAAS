# Phase 5 acceptance

**Status: NOT READY.**

Phase 5A and 5B were recovered with their local commits and Phase 5C source. The recovered Phase 5A suite passed 14/14. Phase 5B and Phase 4B backend acceptance passed 12/12, and the deterministic project matrix passed 9/9. Local IfcOpenShell readback covered twelve fixtures. Native desktop IFC application reopen is unverified.

| Gate | Disposition |
| --- | --- |
| Protected regeneration | Full protected room, unit, wall, opening, furniture and structural comparisons cover supported local scopes. Exact re-hosting restrictions and split-line geometry remain part of the protected acceptance path. |
| Direct CAD and persistence | CAD refuses missing or ambiguous targets. Runtime input checks and compare-and-save are covered by targeted regressions. The disk archive sequence is independent of the accepted Building revision. |
| Unified Studio | Shared canonical selections and revisions drive CAD, BIM and 3D. Production browser verification, export provenance across all requested formats and complete control inventory remain open. |
| 3D and furniture | Layer visibility and decorative lighting are exercised in Chromium. Manual furniture placement uses checked canonical edits on supported orthogonal rooms. Performance and full production coverage remain open. |
| AI and BIM | Typed factual results, controlled edit proposals, scoped clearance and read-only reference support. General external IFC geometry, BCF and live Gemini replay remain outside the verified evidence. |
| Nine real projects | Nine deterministic software checks passed. Full E2E matrix, actual reference influence, visual review and native format evidence are open. |
| Structural | Separate structural workspace and model exchange preserve the architecture-first workflow. Professional review required. |
| Independent CI | The first Phase 5 checkpoint's independent planning and IFC jobs passed. Its combined verification job failed before Chromium. See the handoff for run and commit identities. |

[Engineering handoff](../repair/PHASE5_CODEX_HANDOFF.md) · [Project matrix](PHASE5_REAL_PROJECT_ACCEPTANCE.md) · [Performance evidence](PHASE5_PERFORMANCE_REPORT.md)
