# Residential Phase 3 brief: source reconciliation required

Reviewed 2026-11-09 against the current implementation and the official UDCPR 2020 consolidation through 2025-01-30. This snapshot does not establish applicability of later amendments.

Application source was not changed during this review. The most recent completed repository verification remains 1,469 passing tests, seven existing opt-in skips and 16 successful typecheck/build dependency tasks; those gates were not rerun for this documentation-only review.

## Blocking discrepancies

| Requested rule | Verified source / unresolved issue | Required treatment |
| --- | --- | --- |
| Exempt stilt parking with clearance below 2.4m | UDCPR 8.1.1(i), printed p145 / PDF p167, specifies minimum 2.4m below beams. Clearance compliance and FSI exemption eligibility are separate decisions. | Never pass a below-minimum parking clearance or automatically infer an exemption. |
| One residential FSI table for Pune, Nagpur and Beed | Table 6-G, printed p116 / PDF p138, distinguishes corporations from remaining authorities. At exactly 12m, non-congested corporation potential is 1.10 basic + 0.50 premium + 0.65 TDR = 2.25 before ancillary. Remaining authorities have 1.10 + 0.30 + 0.60 = 2.00. Neither equals the proposed 1.90. Congested tables differ again. | Preserve authority/zone-specific source tables and distinguish potential from approved/purchased rights. |
| Side margin H/3 minus 1.5m; blanket road-front margins | Table 6-D and 6.2.3, PDF pp130–137, use table height/floor conditions and H/5 above those limits, with parking-height exclusions and further applicability conditions. | Keep source-backed applicability; any separate project policy must be explicitly labelled. |
| Residential travel distance <=30m | UDCPR 9.28.4 Table 9-D, printed p163 / PDF p185, gives baseline residential travel of 22.5m. The table's 30m row covers other occupancies. The verified whole-building sprinkler exception is conditional. | Do not replace the applicable 22.5m gate with an unconditional 30m pass. |
| All balconies automatically exempt below 15% | The brief alternately uses built-up, habitable-room and carpet area as the denominator. The applicable exemption, conditions and source clause have not been established. | Retain measured candidate areas and NOT_VERIFIED exemption eligibility until the formula and applicable source are established. |
| NBC fixed thresholds labelled verified statutory standards | The original applicable NBC 2016 Part 3/4 clauses have not been verified in this workspace. UDCPR has separate room, stair and shaft provisions. | Requested values can be identified as ASSERTED_FROM_BRIEF design policy; they cannot be labelled VERIFIED_FROM_SOURCE NBC compliance. |
| IS 1893 soft-storey checked from a stilt floor plan | No structural stiffness model, material/member properties, loads, applicable edition or solver result is supplied. | Structural soft-storey assessment must remain NOT_RUN / missing engineering inputs. |
| Residential Vastu compliance | The requested orientation preferences are advisory design scoring, with no established statutory or structural safety status. Missing ownership, master-bedroom designation, entrance topology and tank geometry must remain unknown. | Use a separate advisory report; never substitute Vastu scores for statutory or structural checks. |

## Implementation resolution

The current canonical Building contract, measured ledger, jurisdiction context, source registry and revision-bound report remain authoritative. Do not introduce a second divergent BuildingPlan model. Residential adapters may reuse those measurements and publish separate project-policy and advisory Vastu results. Missing facts must be represented explicitly instead of assigning zero to unknown exemptions or awarding full scores for absent rooms/tanks. Runtime contracts must permit unknown required/provided values.

Verified source rules take precedence in statutory results. A fixed project policy may be evaluated separately with its brief provenance and must not relax an applicable statutory minimum. Exact clause adoption and current local amendment applicability still require professional verification.

## Sources and stop instruction

- Official UDCPR PDF: https://dtp.maharashtra.gov.in/wp-content/uploads/2025/01/UDCPR%20Updated%2030.01.25%20with%20earlier%20provisions%20%26%20corrections_compressed.pdf
- Local source fingerprint and retrieval evidence: docs/phase3/source-evidence.json. Relevant PDF pages were reread during this review.
- Official NBC edition information: https://www.bis.gov.in/standards/national-building-code/?lang=en . This landing page does not verify the brief's individual numerical clauses.
- AGENTS.md, Source reality: "If instructions conflict with actual code, types or tests, stop and report the conflict. Do not silently force the repository to match a summary."

This instruction applies because the requested literal statutory contracts and replacement formulas contradict the existing source-backed tables and fail-closed contracts. Implementation has been stopped at this reconciliation report; no production-readiness or completed Phase 3 claim is made.
