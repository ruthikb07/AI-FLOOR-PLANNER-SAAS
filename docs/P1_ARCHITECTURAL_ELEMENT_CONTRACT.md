# P1 Architectural Element Contract

Date: 2026-11-10. Scope: architectural semantics, newly generated geometry, and projection/export parity. Existing uncommitted work is preserved. No commit, merge, or push was performed.

**Automated checks provide engineering design assistance and require verification by a licensed Architect/Engineer before municipal submission.** Internal software checks do not certify a design, statutory compliance, structure, fire safety, or construction readiness.

## 1. Canonical contract

`Building` and its `Floor` collections remain authoritative. Dimensions and elevations are millimetres. `floor.architecture.schemaVersion = 1` registers semantic elements through stable references to canonical source IDs. It does not maintain a second set of room polygons. A referenced source supplies geometry, dimensions, floor ID and level; `elevationMm` and actual adjacent floor heights supply Z.

The compatibility collection `floor.rooms` contains partition/accounting cells, including open uses. Membership of that collection is never permission to erect four walls. `Room.architecturalRole` identifies the physical use independently of legacy room labels. A floor-level element registry links each role to its source geometry.

Likewise, `floor.walls` retains compatibility boundary records needed by topology, old commands and hosted passages. Each new boundary has an explicit role. **An `OPEN_BOUNDARY` is a zero-height topological boundary, not a physical wall.** Physical consumers must call `isPhysicalBoundary`; they must not extrude all records in this collection.

| Architectural object | Canonical representation | Physical interpretation |
|---|---|---|
| Enclosed habitable room | `ENCLOSED_HABITABLE` room reference | Enclosure only on explicitly generated physical boundaries |
| Enclosed service room | `ENCLOSED_SERVICE` | Actual service enclosure retained |
| Open circulation | `OPEN_CIRCULATION` | Walkable surface; no automatic partitions |
| Parking bay / parking area | `PARKING_BAY`, `PARKING_AREA` | Stall use/markings, not four enclosing walls |
| Vehicle driveway/aisle | `VEHICLE_AISLE` | Continuous circulation surface |
| Stair flight | `STAIR_FLIGHT`, canonical `flight1` / `flight2` | Shared tread/riser geometry and actual inter-level rise |
| Stair landing | `STAIR_LANDING`, `floorLanding` / `midLanding` | Floor-level and half-rise landing are separate polygons |
| Stair enclosure | `STAIR_ENCLOSURE`, `PROTECTED_STAIR_ENCLOSURE` | Full enclosure retained; protection rating needs review |
| Rooftop stair cover | `STAIR_MUMTY` | Enclosure, hosted terrace exit, and cover slab |
| Lift shaft | `LIFT_SHAFT` | Shaft opening/enclosure, distinct from lobby or car |
| Lift lobby | `LIFT_LOBBY` | Circulation surface; shaft geometry is not reused as lobby |
| Lift car | `LIFT_CAR` role reserved | Manufacturer-specific car geometry is not fabricated from shaft dimensions |
| Lift headroom/equipment | `LIFT_HEADROOM`, `LIFT_EQUIPMENT`; roof reservation zones | Actual manufacturer envelope requires configuration; a reservation is not a machine room |
| Balcony slab | `BALCONY_SLAB` | External dwelling surface with real access and protective edges |
| Balcony railing/parapet | `GUARDRAIL`, `PARAPET` boundary | Low protective boundary; dwelling separation may remain full height |
| Open terrace slab | `OPEN_TERRACE` | Continuous open roof surface, with explicit holes and local enclosures |
| Terrace parapet | `PARAPET` boundary | Edge protection, not a roof-wide partition network |
| Terrace drainage/slope | `architecture.drainage`, `ROOF_DRAINAGE` role | Typed slope ratio, fall direction and outlets; absent design is `NOT_VERIFIED` |
| Service duct/shaft | `SERVICE_SHAFT` | Distinct service void/enclosure |
| Open-to-sky courtyard | `OPEN_TO_SKY_VOID`, `openToSky`, `spaceUse: VOID` | Slab cutout with edge protection; no room cap or rooftop enclosure |
| Full-height wall | `FULL_HEIGHT_WALL` | Explicit physical wall solid |
| Half-height wall/parapet | `PARAPET`, `heightMm` | Explicit low wall height |
| Open boundary | `OPEN_BOUNDARY` | Accounting/topology only; no 2D wall ink, 3D solid or CAD wall entity |
| Guardrail | `GUARDRAIL`, `heightMm` | Protective boundary with explicit height |
| Door/window opening | `DOOR_OPENING`, `WINDOW_OPENING` | Hosted canonical opening; actual saved door type controls leaf representation |
| Roof equipment zone | `ROOF_EQUIPMENT_ZONE` | Independent equipment reservation; tank, solar and lift reservations retain separate IDs/tags |

The default 1100 mm guard height is a configurable design proposal, not a statement that this height satisfies every authority, occupancy or edge condition. Guard detailing, openings, loading and anchorage require design review.

## 2. Generation behavior

### Stilt parking

New multi-sheet architectural generation defaults to `structuralLayoutMode: DEFERRED`. It emits no arbitrary columns or beams. The older provisional column/beam profile is available only through `PROVISIONAL_EXISTING_PROFILE`; the explicitly structural hardened API remains a separate provisional workflow, not a structural approval.

Vehicle stalls remain distinct from aisles. Narrow parking remnants below the supported bay width are open remainder cells and are excluded from vehicle capacity. Optional office/gym/service cells are enclosed only when requested; the interactive request no longer enables unrequested office/gym space. Actual toilets, meters, lift shafts and stair enclosures remain enclosed. No enclosing wall is produced solely because an object is labelled parking.

The geometric audit records completely open perimeter edges. This is a conservative software observation, not an authority-specific legal openness certificate or a swept-path turning analysis. Road connection, usable aisle widths, turning envelopes and final required parking capacity still require project-specific verification.

### Balconies

Balcony and outdoor utility surfaces remain part of the existing canonical envelope accounting. The change does not expand balcony projections or change historical gross-area formulas. External edges receive low protective boundaries; full-height separation from an adjoining enclosed room is retained, with the dwelling access opening. No four-wall balcony rule is applied. Drainage, waterproofing, guard design and permissible projections remain explicit review items.

### Roof and lift equipment

The roof remains an open terrace surface. Equipment cells are independent reservations, not apartment-style enclosures. Stair mumties keep their enclosure, terrace-access opening and cover. A conventional lift machine room is created only for `liftSystem: MACHINE_ROOM_REQUIRED`; `UNSPECIFIED` and `MACHINE_ROOM_LESS` do not imply one.

The existing source allocator already distinguished sufficiently large OTS courtyards from service shafts. That classification now survives typical-floor, stilt and roof assembly. An OTS courtyard remains open at roof level, rather than becoming a full-height MEP head room. Its area is counted as void in the ledger.

Tank/PV footprints do not claim tank volume, equipment height, structural support, maintenance clearance or hydraulic/solar design. Missing manufacturer headroom, drainage slopes and outlet positions remain `NOT_VERIFIED`; this phase does not fill those inputs with invented values.

### Physical stairs

New generation registers real stair geometry on every physical level. Each stair has two flights, an intermediate landing, a floor landing, an actual rise derived from adjacent elevations, riser counts and measured tread depth. Rectangular enclosure/host geometry is solved in geometry-engine. The architectural proposal uses a 1200 mm flight target and a 175 mm riser target; these are disclosed design parameters, not statutory approval. Compact footprints can require further stair dimension/headroom design review.

The new-generation coordinator selects a real common-space host, registers the access opening, aligns that host across levels and gives each vertical core a stable identity. It fails explicitly if a valid aligned host is unavailable. It does not run when an old project is loaded.

The terrace has an arrival landing instead of a flight to a nonexistent upper floor. Both 3D paths cut the stair enclosure from the floor plate and restore the actual floor landing, so a slab or room overlay does not cap the stair. The shared geometry also supplies treads/landings to 2D and CAD. Semantic stair cores no longer receive a second decorative furniture-stair symbol. Mumty cover geometry remains above the terrace arrival.

All freshly generated openings carry explicit V1 centre-position metadata, based on the actual generation/repair producers. Historical untagged openings are not silently converted. Their swings are selected against the actual destination polygon so they do not sweep into the floor landing. The review panel reads the canonical landing instead of assuming an external landing beyond a legacy stair box. Existing canonical hinged stair doors keep their leaves. Renderers/exporters no longer suppress them merely because their ID or adjacent room name contains “stair”. Open passages and sliding doors retain their own canonical types. This change does not globally remove stair walls, protected enclosures or doors. Fire rating, door swing/evacuation clearance, stair guards, headroom and travel-distance verification remain professional design checks.

## 3. Validation and accounting

Core validation checks architectural schema, reference resolution, duplicate element IDs, boundary roles and positive finite physical heights. Windows require full-height hosts; a hinged leaf cannot be hosted on a purely open boundary. Geometry inspection checks enclosed parking misuse, dwelling-to-balcony access, stair polygons, blocked stair exits and OTS flags, while issuing separate review-required findings for unresolved drainage, projections, headroom and fire protection.

Open boundaries do not occupy physical wall area. The ledger retains clipped centreline-cell accounting and the raw `abs(gross - accounted) < 0.001 mm²` comparison. Explicit `VOID` cells now contribute to void area instead of unassigned area. Gross area is never changed or delta rounded to force acceptance. The existing balcony/utility envelope intersection formula is preserved.

The P1 checks are bounded. They do not prove absence of all door-sweep, equipment-route, vehicle-swept-path or furnishing conflicts. For example, an older compact default-setback apartment case can still produce an oversized bathroom reachability opening on a short host; the mesh exporter correctly rejects that opening. This pre-existing room-layout/opening issue is not reclassified as P1 architectural success. The inspected browser configuration uses explicit 3/2/2/2 m setbacks and is tested through both 3D paths.

## 4. Serialization and old projects

All additions are optional, additive fields. Existing JSON can load without an architectural model. Serialization preserves optional roles, boundary heights, source references, floor landings and drainage status. Core edit commands refresh references only for models already using the architectural schema.

`withArchitecturalElements` is a pure annotator. It does not delete historical walls, replace saved polygons, resize old rooms or invoke a cleanup migration. New-generation stair/semantic finalization is separate from deserialization. Tests verify nonmutation, annotation idempotence and save/reload equality. Historical geometry requires an explicit future reviewed migration before reinterpretation; there is no automatic destructive conversion on load.

## 5. Projection and export agreement

- SVG omits physical ink for open boundaries, distinguishes guards/parapets, exposes semantic data attributes, and uses shared canonical stair polygons. Canonical hinged stair door types remain visible.
- Interactive Three.js projection omits open wall solids, uses real guard heights, treats semantic room overlays as surfaces, cuts explicit voids/stairs/shafts and uses shared stair/mumty solids.
- Export/Blender scene projection uses the same stair solids and architectural slab holes. Balcony slabs can be emitted as separate meshes; aggregate geometry equals the corresponding floor plate/surface representation.
- Architectural DXF mapping omits open wall solids and uses `A-GUARD` for protective boundaries, `A-SLAB` for semantic floor outlines, `A-PARK-STAL` for markings, `A-ROOF-EQPM` for reservations and `A-STAIR` for canonical stair parts. A parking/equipment cell polygon is not exported as an enclosing room wall.
- Artifact verification accepts the correct semantic slab-outline layer while retaining actual boundary vertex/area checks. Both regular CAD and residential standards serializers use source stair geometry. Native export errors remain errors; unavailable binaries are not replaced by fake DWG bytes.

## 6. Verification evidence

P1 regression file: `packages/backend/src/__tests__/architectural-elements.test.ts` (11 tests). Covers open parking/core boundaries, balcony/roof guards, conditional machine rooms, deferred structural placement, actual active-generator stairs and terrace access, stair holes/floor landings in both 3D paths, shared 2D tread geometry, retained hinged stair CAD arcs, save/reload, nonmutating legacy annotation, one/four residential levels, decimal dimensions, irregular source polygons and explicit OTS cutouts.

Final command results and browser observations are recorded below after execution. Generated test/export evidence belongs under `test-artifacts/p1/`; ignored execution logs are retained at the repository root. Prior user/concurrent modifications and test-produced tracked artifacts were not restored or discarded.

## 7. Statutory scope

This model targets the Maharashtra UDCPR/NBC residential workflow but does not assert legal applicability or approval. The [official UDCPR 2020 notification/text](https://www.mmrda.maharashtra.gov.in/sites/default/files/2021-10/UDCPR%20Sanctioned%20with%20Notification.pdf) and [published consolidated UDCPR text](https://www.mmrda.maharashtra.gov.in/sites/default/files/2023-10/UDCPR_compressed_2.pdf) distinguish open stilt/terrace uses and regulate balconies. Effective amendments, the specific planning authority, congestion category and project conditions must be verified separately. No universal balcony projection or structural member dimension is inferred here.

**Automated checks provide engineering design assistance and require verification by a licensed Architect/Engineer before municipal submission.**
