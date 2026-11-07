# STAGE B & C — DEFECT INVENTORY & RESOLUTIONS
**Run ID:** `apartment-geometry-20261009-closure`

## 1. Identified Defects & Hard Risks Audited

### Defect 1: Contract Hash Setback Sensitivity & Property Ordering Invariance
- **Source:** `packages/ai-orchestration/src/apartment/contract.ts`
- **Root Cause:** Historical implementation omitted individual setbacks from the canonical hash payload when aggregate width/depth remained unchanged. Furthermore, arbitrary JavaScript object key insertion order could produce hash mismatches.
- **Resolution:** Re-verified and enforced explicit canonical setback key sorting (`front`, `rear`, `left`, `right`) in `computeApartmentContractHash`. Added dedicated regression tests confirming hash sensitivity to individual setback variations with identical aggregate buildable footprints.
- **Severity:** `P0 - INTEGRITY`

### Defect 2: Area Ledger SpaceUse Fallback
- **Source:** `packages/geometry-engine/src/apartment-ledger.ts`
- **Root Cause:** If `room.spaceUse` was undefined on a room instance (e.g. created ad-hoc without explicit tags), the ledger previously fell back to `unitId ? 'unitUsable' : 'unassigned'`, incorrectly counting outdoor balconies or vertical core elements as unit carpet.
- **Resolution:** Updated `measureApartmentAreaLedger` to fallback to `r.spaceUse ?? roomSpaceUse(r)` and enhanced balcony filtering to check `r.spaceUse === 'OUTDOOR' || r.type === 'balcony'`.
- **Severity:** `P1 - METRIC ACCURACY`

### Defect 3: Historical Core Subcomponent Discrepancy ($52.5\text{ m}^2$ vs $61\text{ m}^2$)
- **Source:** `GOLDEN_OVERFITTING_AND_METRIC_AUDIT.md`
- **Root Cause:** Early design reports claimed a total core area of $52.5\text{ m}^2$ while listing subcomponents (lifts 9 + stairs 28 + lobby 18 + shafts 6) totalling $61\text{ m}^2$.
- **Resolution:** Reconciled via cellular planar decomposition in `measureApartmentAreaLedger`. Core area is measured directly from the geometric union of lift and stair polygons ($23.36\text{ m}^2$ for shafts/stairs, plus dedicated circulation for lobby), achieving exact mathematical conservation ($Delta = 0.000\text{ mm}^2$).
- **Severity:** `P1 - LEDGER RECONCILIATION`

### Defect 4: Spurious Room Collisions on Shared Partitions
- **Source:** `packages/planning-engine/src/refinement/boundary-snap.ts`
- **Root Cause:** Shared $115\text{ mm} / 230\text{ mm}$ demising walls between adjacent rooms triggered 20–25 false positive collision errors under zero-tolerance bounding box intersection.
- **Resolution:** Constrained `snapRoomBoundaries` to a rigorous $\le 250\text{ mm}$ tolerance threshold, eliminating false positive wall overlaps while rejecting genuine geometric intrusions ($> 250\text{ mm}$).
- **Severity:** `P0 - PIPELINE STABILIZATION`
