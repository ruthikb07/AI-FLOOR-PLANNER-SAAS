# Phase 5.2 release candidate

**NOT READY.** GitHub dispatched the authorized live reference workflow twice on the Phase 5.1 anchor. Both runners received an empty Gemini credential and made zero provider calls. The action-family matrix documents partial control coverage. The targeted FreeCAD native IFC reopen gate passed.

Phase 5.2 starts at `3369a634ad9c5dd6aea7577e3118420b1e9cb621` on the dedicated `fix/phase5-release-candidate` branch. [Verified anchor](https://github.com/ruthikb07/AI-FLOOR-PLANNER-SAAS/actions/runs/45802566532)

| Gate | Evidence and disposition |
| --- | --- |
| Mandatory architecture | A 50 mm shift on a second residential storey reproduced zero blockers with the stale baseline audit. The shared gate now measures canonical chase footprints and rejects a mismatch. It evaluates explicit core counts, OTS and required riser coverage from the current model. Existing strict areas, shape locks and protected edit checks remain in force. |
| Parametric core | [Parametric core verification](PARAMETRIC_CORE_VERIFICATION.md) |
| Plumbing reservations | [Wet-wall coordination verification](WET_WALL_COORDINATION_VERIFICATION.md) |
| Area | [Measured target errors](IRREGULAR_AREA_TARGET_VERIFICATION.md) |
| Live AI | [GitHub credential and replay evidence](LIVE_REFERENCE_INFLUENCE_VERIFICATION.md) |
| UI controls | [Action-family coverage](PHASE5_2_CONTROL_MATRIX.json) |
| Native IFC | [FreeCAD capability and evidence](NATIVE_IFC_REOPEN_VERIFICATION.md) |

Automated checks provide engineering design assistance and require verification by a licensed Architect/Engineer before municipal submission. The modeled egress graph establishes reachable openings and passages within its audited scope. Certified fire design, detailed plumbing and structural certification remain separate.

The focused backend, topology and IFC run passed seven selected tests, and two additional wet-wall geometry tests passed. The Windows project and survey matrix passed all 14 tests. It verified independent settings, protected CAD digest equality, a matching IFC export digest, rendered floor isolation and separation, dining visibility, and canonical furniture movement and rotation.

The two consecutive Windows production Chromium repair batches each passed 23 tests on the browser checkpoint. The full Tower orbit completed within the configured software-rendering budget in both. The separate Direct3D 11 replay passed both tests, including the hardware renderer assertion. The software WebGL replay recovered all five contexts in one frame each. The final focused hosted-door test widened an opening by 20 mm, kept its host, served rooms and swing, and read back the accepted revision.
