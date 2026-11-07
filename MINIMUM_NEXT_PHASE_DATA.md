# PROJECT:
AI BUILDING SAAS

REPOSITORY:
C:\Users\ruthi\OneDrive\Desktop\AI BUILDING SAAS

MASTER PHASE:
APARTMENT ARCHITECTURAL GEOMETRY CLOSURE —
PROPER WALLS, SPACE SEGREGATION, ECONOMICALLY USEFUL BALCONIES,
ZERO-HARD-ERROR PLANNING, GEOMETRIC STABILITY,
AND PROFESSIONAL PDF BASELINE

MODEL / EXECUTION STYLE:
Use the strongest available reasoning/coding mode.

This is a substantial implementation phase.

Do NOT stop after:
- changing a few constants,
- improving one SVG,
- making one Golden fixture pass,
- or merely reducing the number of validation errors.

Continue through:
audit
→ implementation
→ deterministic validation
→ visual QA
→ PDF QA
→ regression
→ reports.

============================================================
0. PRIMARY OBJECTIVE
============================================================

The current apartment planning foundations work, but the next product-quality problem is architectural geometry.

Focus this phase on:

1. proper architectural wall geometry
2. correct unit/common/core segregation
3. practical apartment zoning
4. useful and area-efficient balconies
5. stable deterministic topology
6. zero HARD_ERROR in accepted deterministic plans
7. canonical-model-driven professional PDF baseline

The expected user experience is:

PROJECT INPUT
→ PROGRAM
→ FEASIBILITY
→ VALID TOPOLOGY
→ PROPER WALLS
→ SEGREGATED UNITS
→ USEFUL BALCONIES
→ 0 HARD ERRORS
→ 2D PLAN
→ PDF

Do NOT add:
- structural analysis
- RCC design
- columns/beams as engineered members
- reinforcement
- foundations
- soil engineering
- MEP engineering
- BOQ
- actual construction costing
- detailed Blender
- elevations

Those remain outside this phase.

============================================================
1. IMPORTANT TERMINOLOGY
============================================================

"STABLE" in this task means:

- deterministic geometry
- reproducible topology
- robust wall intersections
- stable room ownership
- stable openings
- no random geometry corruption
- save/reload stability
- repeated-generation consistency

It does NOT mean:

STRUCTURAL STABILITY.

Do not make structural engineering claims.

"ECONOMICALLY USEFUL" balcony means:

- useful architectural area
- not excessive non-saleable area
- practical access
- reasonable shape
- good relation to living/bedroom
- efficient facade use

It does NOT mean:

final rupee construction-cost optimization.

Use:

RELATIVE PLANNING EFFICIENCY

not:

CONSTRUCTION COST.

============================================================
2. SOURCE OF TRUTH
============================================================

Preserve the architecture:

REVIEWED PROGRAM
+
SITE / PROJECT FACTS
↓
DETERMINISTIC PLANNER
↓
CANONICAL BUILDING MODEL
↓
VALIDATION
↓
RENDERER / EDITOR / PDF

The canonical Building Model remains authoritative.

SVG is not authoritative.
PDF is not authoritative.
FLUX image is not authoritative.
Gemini extraction is not authoritative.
React state is not authoritative.

Any editor mutation must update canonical geometry.

All validation and PDF output must derive from the SAME canonical revision.

============================================================
3. REPOSITORY SAFETY
============================================================

The repository contains many existing and possibly unrelated modifications.

Before editing:

- inspect git status
- inspect current HEAD
- inspect touched modules
- identify pre-existing changes

DO NOT:

git reset
git clean
git stash
git restore unrelated files
git checkout unrelated files
git add .
commit

Do not overwrite unrelated work.

At the end report exact changed files.

============================================================
4. FIRST AUDIT CURRENT IMPLEMENTATION
============================================================

Before coding, trace:

PROGRAM
→ APARTMENT CONTRACT
→ AREA BUDGET
→ CORE
→ ENVELOPES
→ ROOM TOPOLOGY
→ ROOM GEOMETRY
→ WALL GENERATION
→ OPENINGS
→ VALIDATION
→ RENDERER
→ EDITOR
→ PDF

Identify current files/functions for:

- wall centerlines
- wall thickness
- wall faces
- wall intersections
- shared walls
- external walls
- internal partitions
- room boundaries
- apartment boundaries
- core boundaries
- door host walls
- window host walls
- balconies
- outdoor spaces
- residual/unassigned areas
- validation
- PDF

Do NOT assume documentation is accurate.

Current source wins.

Create:

APARTMENT_GEOMETRY_BASELINE_AUDIT.md

============================================================
5. AUDIT ALL CURRENT WALL CONSTANTS
============================================================

Find all wall-related constants.

Examples already known may include:

230 mm
150 mm
115 mm
100 mm

but verify current source.

For every wall constant classify:

- external wall
- internal unit wall
- unit separation wall
- core wall
- shaft wall
- balcony/parapet
- unknown

Also classify provenance:

OFFICE_STANDARD
REGULATION_VERIFIED
USER_PROVIDED
HEURISTIC
UNVERIFIED

Do not silently call heuristic thicknesses statutory.

============================================================
6. CREATE A WALL SEMANTIC MODEL
============================================================

Walls must not be generic rectangles with no architectural meaning.

Introduce or strengthen semantics such as:

WallUse =
EXTERNAL
INTERNAL_PARTITION
UNIT_SEPARATION
COMMON_CORRIDOR
CORE
SHAFT
BALCONY
PARAPET

Each canonical wall should support where architecture permits:

id
floorId
sourceRoomIds
sourceZoneIds
wallUse
centerline
thickness
start
end
height
host openings
leftSpaceId
rightSpaceId
geometry provenance

Do not duplicate wall geometry if an existing canonical type already supports these concepts.

Extend minimally.

============================================================
7. SHARED WALL LOGIC
============================================================

Two adjacent rooms must NOT independently generate two overlapping walls.

Example:

BEDROOM A
│ WALL
BEDROOM B

must produce:

ONE shared partition wall

not:

wall A
+
wall B overlapping.

Likewise apartment-to-apartment boundaries should produce one shared separation wall geometry.

Build or strengthen:

WallGraph

or equivalent topology.

For every wall segment know:

left ownership
right ownership

Example:

FLAT_01_BEDROOM / FLAT_01_PASSAGE

FLAT_01 / COMMON_CORRIDOR

FLAT_01 / FLAT_02

INTERIOR / EXTERIOR

CORE / COMMON_LOBBY

============================================================
8. WALL INTERSECTION ROBUSTNESS
============================================================

Fix:

T-junctions
L-junctions
cross intersections
corner joins
shared endpoints
tiny gaps
tiny overlaps
collinear duplicates

Use deterministic geometric tolerances.

Do not apply broad 250 mm snapping that can redesign rooms.

Define separate tolerances for:

numerical coincidence
wall join
opening host matching
room polygon repair

Keep tolerances small, explicit and tested.

============================================================
9. NO FALSE WALL COLLISION ERRORS
============================================================

Shared partitions must not be reported as overlapping-room errors.

Audit:

detectRoomCollisions

and all room/wall collision validators.

Distinguish:

VALID SHARED BOUNDARY

from:

INVALID AREA OVERLAP.

A 115/150/230 mm shared wall must not cause both adjacent rooms to be classified as overlapping.

============================================================
10. ROOM POLYGON / WALL CONSISTENCY
============================================================

Choose one clear geometric contract.

For example:

ROOM USABLE POLYGON
= inside wall faces

WALLS
= thickness outside usable polygon boundary relationship

or preserve the repository's existing model if different.

Do not mix:

room centerline boundary

with:

finished face dimensions

in different modules.

Document the convention.

Add tests.

============================================================
11. AREA DEFINITIONS
============================================================

Create clear non-overlapping area semantics.

At minimum:

ROOM_USABLE_AREA
UNIT_USABLE_AREA
UNIT_BUILT_AREA
BALCONY_AREA
CORE_AREA
COMMON_CIRCULATION_AREA
SERVICE_AREA
WALL_AREA
GROSS_FLOOR_AREA
UNASSIGNED_AREA

Do not count the same lobby twice.

Do not count wall area both in apartments and core.

One central metric calculator must be used by:

planner
ranking
UI
reports
PDF schedules
tests

============================================================
12. AREA LEDGER INVARIANT
============================================================

For every accepted floor require:

GROSS_FLOOR_AREA
≈
UNIT_AREA
+ CORE_AREA
+ COMMON_CIRCULATION_AREA
+ SERVICE_AREA
+ WALL_AREA
+ OTHER_EXPLICIT_AREA
+ UNASSIGNED_AREA

within explicit numerical tolerance.

If ledger fails:

HARD_ERROR:
AREA_LEDGER_MISMATCH

No manually copied percentages.

============================================================
13. SEGREGATION MODEL
============================================================

Every polygon/space must belong to one of:

UNIT
COMMON
CORE
SERVICE
OUTDOOR
VOID
UNASSIGNED

If UNIT:

unitId is mandatory.

Example:

FLAT_01
FLAT_02
FLAT_03

No room may exist without ownership.

No FLAT_01 room may geometrically cross into FLAT_02.

No private room may cross common circulation.

============================================================
14. APARTMENT BOUNDARIES
============================================================

Create/strengthen one explicit envelope for every apartment.

Each apartment envelope must:

- be contiguous or intentionally defined
- remain inside the floor plate
- not overlap another apartment
- connect to common circulation through its entrance
- contain all its owned rooms
- contain no common/core spaces

Do not infer apartment membership solely from room labels.

============================================================
15. COMMON / PRIVATE SEGREGATION
============================================================

Validate physical separation.

Required:

COMMON LOBBY / CORRIDOR
→ APARTMENT ENTRANCE
→ APARTMENT FOYER OR PUBLIC ZONE
→ PRIVATE INTERIOR

Reject:

common corridor
→ bedroom

common corridor
→ private bathroom

common corridor
→ kitchen
as primary apartment entry unless explicitly approved by a special Program.

============================================================
16. PUBLIC / PRIVATE / SERVICE ZONES
============================================================

Within every apartment maintain:

PUBLIC:
foyer
living
dining

PRIVATE:
bedrooms
private passage
dressing

SERVICE:
kitchen
utility
bathrooms
store where appropriate

OUTDOOR:
balcony
terrace

Use zoning DURING layout generation.

Do not assign zones only after geometry exists.

============================================================
17. PRIVATE BEDROOM ZONE
============================================================

Bedrooms should normally form a private zone.

Avoid:

entrance
→ bedroom
→ living

or:

living
used as mandatory passage to every bedroom

unless brief explicitly asks for such layout.

Prefer:

PUBLIC
↓
PRIVATE TRANSITION
↓
BEDROOM CLUSTER

============================================================
18. BATHROOM OWNERSHIP
============================================================

Keep explicit:

ATTACHED
COMMON
SHARED
UNRESOLVED

An attached bath must have physical access from the correct private room or reviewed dressing/private bay.

Do not infer ownership by proximity.

No bath may accidentally belong to two flats.

============================================================
19. KITCHEN / DINING / SERVICE LOGIC
============================================================

Prefer:

LIVING ↔ DINING

DINING ↔ KITCHEN

KITCHEN ↔ UTILITY

where Program requests utility.

Avoid:

bedroom-through-kitchen

bathroom-through-kitchen

utility through bedroom

Keep service circulation compact.

============================================================
20. APARTMENT ENTRANCE QUALITY
============================================================

Every apartment must have:

exactly one primary apartment entrance
unless Program explicitly allows additional entries.

Entrance should connect:

COMMON
→ FOYER / PUBLIC ZONE

not:

COMMON
→ PRIVATE BEDROOM

Score privacy.

============================================================
21. BALCONY MODEL
============================================================

Balconies must become real first-class architectural spaces.

Each balcony should have:

id
floorId
parentUnitId or COMMON
boundary
area
width
depth
accessDoorId
adjacentRoomIds
exteriorEdge
balconyUse

Potential balconyUse:

LIVING_BALCONY
BEDROOM_BALCONY
UTILITY_BALCONY
COMMON_BALCONY
TERRACE_EDGE

============================================================
22. BALCONIES MUST NOT BE RESIDUAL SPACES
============================================================

Do not create a balcony simply because:

"there is an unused strip on the facade."

Balcony generation must be intentional.

Every balcony must have:

purpose
access
usable geometry
parent ownership.

If no useful balcony fits:

omit optional balcony

rather than create an unusable sliver.

============================================================
23. BALCONY USEFULNESS
============================================================

Create:

BalconyUsefulnessScore

Factors:

- usable depth
- usable width
- rectangular/usable proportion
- door access
- relation to living/bedroom
- exterior exposure
- furniture/standing usability
- privacy
- fragmentation
- area efficiency

Do NOT hard-code statutory minima unless verified.

Use existing/project/office values as:

PROVISIONAL DESIGN TARGETS

with provenance.

============================================================
24. BALCONY AREA EFFICIENCY
============================================================

Balcony optimization should NOT mean:

make balcony as small as possible.

It means:

maximize useful value per area consumed.

Example relative metric:

balconyUtilityEfficiency =
usefulnessScore / balconyArea

Also track:

totalBalconyArea
balconyAreaPerUnit
balconyAreaRatio

Do not allow balcony area to grow uncontrollably at the expense of:

bedrooms
living
kitchen
core
circulation.

============================================================
25. BALCONY FRAGMENTATION PENALTY
============================================================

Prefer:

one useful living balcony

over:

three tiny unusable balcony strips

unless brief requests multiple balconies.

Penalize:

- very narrow fragments
- acute shapes
- disconnected balcony pieces
- duplicate decorative strips
- balcony with no valid door
- balcony accessible only through bathroom
- balcony occupying facade without useful interior relation

============================================================
26. LIVING BALCONY PRIORITY
============================================================

Where a balcony is requested and geometry permits:

prefer living/dining connection.

Bedroom balcony may be secondary.

Utility balcony should relate to kitchen/service.

Do not force this as legal requirement.

Use it as architectural preference unless project Program says otherwise.

============================================================
27. BALCONY / WALL INTERACTION
============================================================

Balcony edges must generate appropriate:

external wall
door/opening
parapet/edge semantics

Do not accidentally create:

full-height wall across balcony access.

Balcony door must host on a valid facade/internal-balcony wall.

============================================================
28. BALCONY AREA SCHEDULE
============================================================

For each apartment report:

usable interior area
balcony area
utility balcony area
total outdoor area

Do not hide balconies inside interior usable/carpet metrics.

Keep area definitions explicit.

============================================================
29. EXTERIOR WALL OPPORTUNITY
============================================================

Rooms requiring exterior opportunity should be placed accordingly.

Prioritize:

living
bedrooms
kitchen where practical.

But do not claim:

"guaranteed cross ventilation"

from facade adjacency alone.

Use statuses such as:

EXTERIOR_EXPOSURE_AVAILABLE
OPENING_PRESENT
SECOND_EXPOSURE_AVAILABLE
VENTILATION_NOT_EVALUATED

============================================================
30. DOORS AS PHYSICAL ACCESS
============================================================

A desired adjacency is NOT enough.

For every required direct access:

verify a physical door/opening.

Examples:

foyer → living
bedroom → attached bath
kitchen → utility

If graph says connected but no opening exists:

HARD_ERROR:
REQUIRED_ACCESS_OPENING_MISSING

============================================================
31. DOOR PLACEMENT
============================================================

Doors must:

- lie on host wall
- remain inside wall segment
- not overlap wall junction
- not overlap another opening
- have usable swing or opening representation
- connect intended two spaces

Avoid doors at impossible corners.

============================================================
32. WINDOW PLACEMENT
============================================================

Windows must:

- host on external wall or approved shaft wall
- belong to intended room
- not span wall corners
- not overlap door/opening
- remain inside wall extents

Window count/size remains office/project data unless verified.

============================================================
33. CORE WALLS
============================================================

Core must be physically separated from units.

Lifts, stairs, shafts and common lobby must have clear wall boundaries.

Do not allow:

lift shaft polygon inside apartment room

stair through bedroom

shaft without enclosure where enclosure is required by architectural representation.

No structural/fire certification claim.

============================================================
34. CIRCULATION STABILITY
============================================================

Every unit entrance must reach:

common lobby/core.

Every room must reach:

unit entrance

through valid interior access.

Create graph checks:

ROOM
→ UNIT NETWORK
→ ENTRANCE
→ COMMON NETWORK
→ CORE

No disconnected island.

============================================================
35. RESIDUAL AREA HANDLING
============================================================

Any region not assigned intentionally must become:

UNASSIGNED_AREA

Do not:

- silently merge into a room
- silently create a new flat
- silently create balcony
- silently label it lobby

Report:

unassignedArea
unassignedAreaRatio

Large residual area penalizes candidate.

============================================================
36. ZERO HARD ERROR GATE
============================================================

Accepted deterministic candidate must have:

hardErrorCount = 0

Examples HARD_ERROR:

UNIT_COUNT_MISMATCH
UNIT_PROGRAM_INCOMPLETE
ROOM_OVERLAP
UNIT_OVERLAP
ROOM_OUTSIDE_UNIT
UNIT_OUTSIDE_FLOOR_PLATE
CORE_CONFLICT
DISCONNECTED_ROOM
DISCONNECTED_UNIT
MISSING_PRIMARY_ENTRANCE
REQUIRED_ACCESS_OPENING_MISSING
WALL_TOPOLOGY_INVALID
OPENING_HOST_INVALID
BALCONY_ACCESS_INVALID
AREA_LEDGER_MISMATCH

Do not show candidate as READY if any hard error exists.

============================================================
37. WARNING VS HARD ERROR
============================================================

Do not turn architectural preferences into hard errors.

Examples warnings:

BALCONY_SMALLER_THAN_PREFERRED
BALCONY_FRAGMENTED
LONG_INTERNAL_PASSAGE
LOW_EXTERIOR_EXPOSURE
SUBOPTIMAL_FURNITURE
HIGH_CIRCULATION_RATIO
HIGH_WALL_LENGTH
UNBALANCED_UNIT_QUALITY

Warnings affect ranking.

They do not automatically invalidate geometry.

============================================================
38. GENERATE MORE THAN DISPLAY COUNT
============================================================

Internally generate multiple cheap deterministic candidates.

Example:

20–40

within bounded runtime.

Then:

HARD VALIDATE
↓
DISCARD INVALID
↓
ARCHITECTURAL SCORE
↓
BALCONY SCORE
↓
SEGREGATION SCORE
↓
AREA EFFICIENCY
↓
DIVERSITY FILTER
↓
TOP 3–4

Never show 4 invalid plans just to fill 4 cards.

============================================================
39. GEOMETRIC STABILITY TEST
============================================================

Run same:

Program
Site
Seed

multiple times.

Deterministic pre-FLUX output must have identical:

unit count
room ownership
wall graph
wall coordinates
balcony count
balcony coordinates
core geometry
metrics

Canonical hash should remain stable.

============================================================
40. SMALL INPUT CHANGE TEST
============================================================

Test small legitimate input change.

Example:

3BHK target area:
110 m²
→
112 m²

System should adapt locally.

It should NOT suddenly:

change 3 flats to 4
move core to unrelated location
swap ownership
destroy circulation

Measure topology stability.

============================================================
41. EDIT STABILITY
============================================================

If user edits:

wall
room size
door
balcony

then:

canonical revision increments

validation becomes stale

metrics recalculate

PDF becomes stale

dependent artifacts invalidate.

Do not allow stale PASS badge after geometry edit.

============================================================
42. PDF IS A PROJECTION OF CANONICAL GEOMETRY
============================================================

PDF generation must use:

Canonical Building Revision

not:

FLUX image

not:

screenshot

not:

separate plan geometry

not:

stale SVG state.

One geometry source.

============================================================
43. PROFESSIONAL PDF BASELINE
============================================================

Current PDF path may be simplified/fit-to-page.

Upgrade it to a reliable architectural PDF baseline.

At minimum support:

- vector geometry where current tooling permits
- floor title
- project title/reference
- revision
- north arrow if known
- scale
- sheet size
- room labels
- room areas
- walls with visible thickness
- doors
- door swings where supported
- windows
- stairs
- lifts
- balconies
- common spaces
- dimensions
- scale bar
- validation/review status disclaimer

============================================================
44. PDF SCALE MUST BE REAL
============================================================

Do not merely print:

SCALE 1:100

while using arbitrary fit-to-page.

Implement one of:

EXACT_SCALE

or:

FIT_TO_PAGE clearly marked NOT TO SCALE.

For EXACT_SCALE:

drawingScale must correspond to geometry.

Example:

10 m real wall at 1:100
must measure approximately 100 mm on printed sheet
within explicit PDF rendering tolerance.

Create automated scale tests.

============================================================
45. PDF PAGE CONFIGURATION
============================================================

Support configurable:

A4
A3
A2
A1

where current PDF library permits.

For first acceptance:

at minimum support one reliable professional baseline:

A3 LANDSCAPE

with configurable:

1:50
1:100

If geometry cannot fit at requested scale:

do NOT silently shrink.

Return:

PDF_SCALE_DOES_NOT_FIT_SHEET

and recommend:

larger sheet
or smaller scale.

============================================================
46. PDF WALL QUALITY
============================================================

PDF must visibly distinguish:

external walls
internal walls
unit boundaries/core where appropriate

Use canonical thickness.

Do not render every wall as same single hairline.

Avoid double-drawn overlapping partitions.

============================================================
47. PDF BALCONY QUALITY
============================================================

Balcony must be identifiable.

Render:

boundary
access door
label
area

Example:

LIVING BALCONY
6.2 m²

Do not confuse balcony with:

interior room
residual
terrace
void.

============================================================
48. PDF AREA SCHEDULE
============================================================

Add a small schedule per floor if architecture supports it.

Example:

FLAT 01
3BHK
Interior usable:
Balcony:
Other outdoor:
Total planned unit area definition:

FLAT 02
...

COMMON:
Core:
Circulation:

Use the authoritative area ledger.

Do not display contradictory ratios.

============================================================
49. PDF VALIDATION STATUS
============================================================

PDF footer or status block should say something like:

INTERNAL ARCHITECTURAL PLANNING VALIDATION:
PASS

HARD ERRORS:
0

WARNINGS:
N

REGULATORY COMPLIANCE:
NOT VERIFIED / PARTIAL / VERIFIED

PROFESSIONAL REVIEW:
REQUIRED / REVIEWED

Do not print:

PMC APPROVED
NBC APPROVED
CONSTRUCTION READY

unless real external process exists.

============================================================
50. PDF EXPORT NAME / REVISION
============================================================

Filename should include stable project/revision identity.

Example:

<Project>_<Floor>_<Revision>.pdf

PDF metadata should include:

buildingId
buildingRevision
programRevision if available
generatedAt
scale
sheet
floorId

============================================================
51. NO DXF CLAIM IN THIS PHASE
============================================================

Do not implement or claim DXF unless already genuinely supported.

This phase is:

PDF BASELINE.

Existing SVG/JSON may remain.

Do not rename another format to DXF.

============================================================
52. WALL / BALCONY EDITOR INTEGRATION
============================================================

Ensure editor displays canonical wall geometry.

Selection should be able to identify:

wall
room
door
window
balcony

where existing editor supports these concepts.

Do not create a second editing geometry model.

============================================================
53. BALCONY EDIT VALIDATION
============================================================

When balcony is resized:

validate:

area
depth/width usability
access
unit ownership
floor-plate/site relationship
opening relation

Recompute planning efficiency.

============================================================
54. WALL EDIT VALIDATION
============================================================

When wall moves:

update:

adjacent room geometry
area
ownership
openings
validation
metrics

If moving wall makes bedroom inaccessible:

show HARD_ERROR immediately.

============================================================
55. PROVENANCE
============================================================

For every project requirement classify source:

USER_REQUIRED
USER_OPTIONAL
OFFICE_STANDARD
REGULATION_VERIFIED
REFERENCE_DERIVED
AI_INTERPRETED
DEFAULT_ASSUMPTION
UNKNOWN

For current wall/balcony values that are not approved standards:

mark:

PROVISIONAL_HEURISTIC

Do not silently promote them.

============================================================
56. REMOVE DANGEROUS GOLDEN FALLBACKS FROM THIS PATH
============================================================

Production apartment generation must not silently default to:

50×50 site
North road
3 flats
3BHK
Golden core

If required project facts missing:

return:

MISSING_REQUIRED_PROJECT_INPUT

List missing fields.

Do not substitute Golden.

============================================================
57. UNKNOWN UNIT TYPE
============================================================

Unknown unit type must NOT become 3BHK.

Return:

UNSUPPORTED_UNIT_TYPE

Supported next-phase types:

1BHK
2BHK
3BHK

unless current approved source says otherwise.

Studio/4BHK/duplex/penthouse remain later unless explicitly supported.

============================================================
58. CENTRALIZE ARCHITECTURAL STANDARDS
============================================================

Do not keep wall/door/balcony/room standards scattered.

Introduce or prepare one:

ArchitecturalStandardsProfile

Containing only architectural heuristics/office defaults.

Possible fields:

walls
openings
balconies
room targets
furniture
drawing

Every field needs provenance.

Do NOT embed regulations into this profile.

============================================================
59. KEEP REGULATIONS SEPARATE
============================================================

ArchitecturalStandardsProfile

is NOT:

RegulationProfile.

Verified statutory constraints must stay separate.

If regulation provider is unverified:

regulatory status = NOT_VERIFIED.

============================================================
60. BALCONY STANDARD PROFILE
============================================================

Create configurable balcony planning settings such as:

preferredMinDepth
preferredTargetDepth
preferredMinWidth
preferredAreaRangeByUse
maxBalconyRatio
fragmentationPenalty
livingBalconyPriority
utilityBalconyPriority

Use current defaults only as:

PROVISIONAL_HEURISTIC

until office schedule exists.

Do not invent statutory minima.

============================================================
61. WALL STANDARD PROFILE
============================================================

Centralize:

external wall preferred thickness
internal partition preferred thickness
unit separation preferred thickness
core wall architectural thickness
shaft wall thickness
parapet thickness

Again:

these are architectural representation defaults,
NOT structural member design.

============================================================
62. ARCHITECTURAL QUALITY SCORE
============================================================

Create or improve explainable quality scoring.

Potential dimensions:

ProgramCompleteness
SegregationQuality
PrivacyQuality
CirculationQuality
WallTopologyQuality
OpeningQuality
BalconyUsefulness
ExteriorExposure
Furnishability
AreaEfficiency
ResidualAreaPenalty

Hard validity always comes first.

============================================================
63. BALANCED UNIT QUALITY
============================================================

For multiple flats calculate:

minUnitQuality
averageUnitQuality
qualityVariance

Do not accept:

FLAT 01 = excellent
FLAT 02 = terrible
FLAT 03 = terrible

just because average score appears high.

============================================================
64. WALL LENGTH / COMPACTNESS PROXY
============================================================

For relative planning efficiency calculate:

totalInternalWallLength
externalPerimeter
unitSeparationWallLength

Penalize obviously fragmented layouts.

Do not translate directly into ₹ cost.

============================================================
65. BALCONY ECONOMY PROXY
============================================================

Report:

totalBalconyArea
usableBalconyArea
balconyFragmentCount
balconyUsefulnessAverage
balconyAreaRatio

Candidate A may have:

larger balcony area
but lower usefulness

than Candidate B.

Ranking should reward useful, compact balconies.

============================================================
66. REQUIRED GOLDEN REGRESSION
============================================================

Retain:

Golden 3 × 3BHK

as ONE regression fixture.

But do not tune this task only to Golden.

It must still pass:

exact unit count
complete Programs
0 hard errors
wall topology
segregation
balcony checks
PDF

============================================================
67. HOLDOUT TESTS
============================================================

Use currently available synthetic/general fixtures where user data is not yet supplied.

At minimum code-level tests:

2 × 3BHK
3 × 3BHK
4 × 2BHK
mixed:
2 × 2BHK + 2 × 3BHK

Do not claim professional generalization acceptance without real holdout briefs.

Label synthetic fixtures clearly.

============================================================
68. WALL TEST MATRIX
============================================================

Tests:

shared wall generated once

adjacent rooms do not overlap

T-junction valid

L-junction valid

external corner valid

tiny numeric gap snaps correctly

large gap does not silently snap

opening remains hosted

unit separation wall preserves ownership

room areas remain stable after wall creation

============================================================
69. SEGREGATION TEST MATRIX
============================================================

Tests:

FLAT_01 cannot own FLAT_02 room

bedroom not common

core not inside unit

balcony ownership explicit

common lobby not counted as unit

private bath ownership preserved

all unit rooms reachable

all unit entrances connect to common

============================================================
70. BALCONY TEST MATRIX
============================================================

Tests:

balcony has owner

balcony has valid access door

balcony cannot exist without exterior edge

thin unusable balcony gets warning/reject according to severity

fragmented balcony penalized

utility balcony connected to kitchen/service

living balcony preference works

balcony area excluded/included according to explicit area definition

balcony area does not corrupt room area

============================================================
71. PDF TEST MATRIX
============================================================

Tests:

PDF generated from canonical revision

PDF contains selected floor

PDF room count matches canonical

wall count/major geometry matches canonical

balcony count matches canonical

lift/stair count matches canonical

labels present

revision present

north arrow only if known

exact-scale test

fit-to-page clearly marked NTS

no unsupported DXF claim

============================================================
72. PDF SCALE TEST
============================================================

Create a known fixture.

Example:

wall = 10,000 mm

requested scale = 1:100

expected paper length ≈ 100 mm.

Verify PDF drawing transformation.

Document tolerance.

This test is REQUIRED before calling PDF:

SCALE VERIFIED.

============================================================
73. VISUAL PDF QA
============================================================

Generate at least:

one Golden PDF

one mixed-unit/synthetic PDF

Visually inspect:

walls
joins
doors
windows
balconies
labels
dimensions
core
white space
sheet clipping

Do not declare professional baseline from unit tests alone.

============================================================
74. AUTOMATED VISUAL ARTIFACTS
============================================================

Save:

SVG plan
PDF plan
area ledger JSON
wall graph JSON
segregation JSON
balcony metrics JSON
validation JSON

for selected fixtures.

============================================================
75. PERFORMANCE
============================================================

Do not reintroduce exponential search.

Record:

candidate generation
wall generation
segregation validation
balcony scoring
canonical validation
PDF generation

Keep bounded.

============================================================
76. ACCEPTANCE METRICS
============================================================

For each accepted plan report:

FLATS REQUESTED
FLATS GENERATED

PROGRAM COMPLETENESS

HARD ERRORS

WARNINGS

ROOM OVERLAPS

UNIT OVERLAPS

DISCONNECTED ROOMS

INVALID OPENINGS

WALL TOPOLOGY ERRORS

BALCONY COUNT

BALCONY AREA

BALCONY USEFULNESS

UNASSIGNED AREA

APARTMENT EFFICIENCY

CORE AREA

COMMON CIRCULATION

WALL AREA

AREA LEDGER DELTA

PDF STATUS

PDF SCALE STATUS

============================================================
77. TARGET ACCEPTANCE
============================================================

For selected deterministic candidate:

hardErrors = 0

room overlaps = 0

unit overlaps = 0

disconnected rooms = 0

invalid openings = 0

wall topology errors = 0

area ledger mismatch = 0 within tolerance

balconies:
all owned
all accessible
all intentional

PDF:
generated
canonical
not clipped
scale verified for exact-scale mode

============================================================
78. NO FAKE ZERO-ERROR RESULT
============================================================

Do NOT:

delete validators
downgrade real geometry failures
increase tolerances massively
disable collision detection
hard-code PASS
write fixed acceptance JSON

Zero hard errors must come from:

correct geometry.

============================================================
79. EVIDENCE MUST BE REAL
============================================================

Acceptance scripts must call actual:

planner
wall engine
validator
renderer
PDF exporter

Do not populate:

hardErrors: 0

as literal report data.

Read actual result.

============================================================
80. ARTIFACT DIRECTORY
============================================================

Create something like:

output/apartment-geometry-closure/

00-baseline/
01-wall-graph/
02-segregation/
03-balconies/
04-selected-candidates/
05-validation/
06-pdf/
07-comparison/

Include actual machine-readable outputs.

============================================================
81. BEFORE / AFTER COMPARISON
============================================================

For same fixture compare:

BEFORE:
wall errors
overlaps
segregation problems
balcony fragmentation
unassigned area
hard errors
PDF fidelity

AFTER:
same metrics.

Visual comparison required.

============================================================
82. REQUIRED REPORTS
============================================================

Create:

APARTMENT_GEOMETRY_BASELINE_AUDIT.md

APARTMENT_WALL_AND_SEGREGATION_IMPLEMENTATION.md

APARTMENT_BALCONY_EFFICIENCY_REPORT.md

APARTMENT_PDF_ACCEPTANCE_REPORT.md

APARTMENT_GEOMETRY_CLOSURE_REPORT.md

============================================================
83. REPORT WALL IMPLEMENTATION
============================================================

Document:

canonical wall convention
wall ownership
shared walls
wall thickness
joins
room face convention
opening hosting
validation

============================================================
84. REPORT BALCONY IMPLEMENTATION
============================================================

Document:

balcony ownership
purpose
area definition
access
usefulness metric
fragmentation
relative planning efficiency

Do NOT claim monetary savings.

============================================================
85. REPORT PDF IMPLEMENTATION
============================================================

Document:

sheet size
scale
drawing transformation
canonical revision
geometry fidelity
unsupported features
visual QA

Explicitly state:

PDF SCALE VERIFIED

only if measured test passes.

Otherwise:

PDF_SCALE_NOT_VERIFIED.

============================================================
86. FULL QUALITY GATES
============================================================

Run:

focused wall tests
focused segregation tests
focused balcony tests
PDF tests
Golden regression
apartment tests
planning-engine tests
geometry-engine tests
constraint-engine tests
renderer tests
frontend export tests
backend relevant tests
full workspace tests
typecheck
lint
git diff --check
build

Do not weaken unrelated tests.

============================================================
87. BROWSER QA
============================================================

If environment permits:

open a generated apartment plan in editor.

Verify:

walls display correctly
rooms separated
balconies clear
selection works
validation = 0 HARD_ERROR
PDF button works
PDF opens

If browser cannot run:

report:

BROWSER_QA_NOT_RUN

not PASS.

============================================================
88. USER-FACING PLAN STATUS
============================================================

Use something like:

ARCHITECTURAL PLANNING

Hard errors:
0

Warnings:
2

Area ledger:
PASS

Wall topology:
PASS

Unit segregation:
PASS

Balcony usability:
PASS

PDF:
READY

Regulatory verification:
NOT VERIFIED

Professional review:
REQUIRED

============================================================
89. DO NOT OVERCLAIM
============================================================

Do not call plan:

construction ready
statutorily approved
structurally safe
PMC approved
NBC certified

This phase is:

architectural planning geometry.

============================================================
90. OPTIONAL AI / FLUX
============================================================

Do not make FLUX the focus.

If current normal pipeline includes FLUX:

retain it.

But deterministic geometry must remain valid independently.

If FLUX unavailable:

wall/segregation/balcony/PDF acceptance should still run offline.

============================================================
91. FINALIZATION BOUNDARY
============================================================

Do not fully implement product finalization unless required.

But prepare PDF export to receive:

buildingRevision
programRevision
validationRevision

PDF must never silently represent stale geometry.

============================================================
92. SECURITY
============================================================

Do not move provider keys frontend-side.

Do not expose secrets in PDF/report/artifacts.

Do not broaden backend exposure as part of this phase.

============================================================
93. REQUIRED CODE REVIEW
============================================================

Before final answer:

inspect diff.

Look for:

Golden hard-coding
fixed PASS results
duplicate metric logic
large tolerances
unverified regulation claims
new second source of geometry
dead code
unused constants

Fix these before reporting completion.

============================================================
94. COMPLETION DEFINITION
============================================================

This phase is complete only if:

A.
walls are physically coherent

B.
shared partitions are represented correctly

C.
apartments/common/core/service are segregated

D.
room ownership is stable

E.
balconies are intentional and usable

F.
balcony area is explicitly measured

G.
accepted plans contain zero genuine HARD_ERROR

H.
metrics reconcile

I.
same canonical plan generates the PDF

J.
PDF geometry is visually usable

K.
exact-scale mode is measured

L.
Golden regression still passes

M.
no hard-coded fake success evidence

============================================================
95. FINAL RESPONSE FORMAT
============================================================

Return:

BASELINE
- wall issues:
- segregation issues:
- balcony issues:
- hard errors:
- PDF status:

WALL SYSTEM
- convention:
- shared wall handling:
- join handling:
- opening hosting:

SEGREGATION
- apartment ownership:
- common:
- core:
- service:
- private/public/service zones:

BALCONIES
- generation strategy:
- usability:
- area metrics:
- fragmentation:
- economic planning effect:

VALIDATION
- hard errors:
- warnings:
- area ledger:
- topology:

PDF
- generated:
- vector:
- scale mode:
- scale verified:
- sheet:
- canonical revision:

GOLDEN REGRESSION
- result:

HOLDOUT/SYNTHETIC TESTS
- results:

TESTS
- focused:
- full:
- typecheck:
- lint:
- diff:
- build:

VISUAL QA
- SVG:
- PDF:
- browser:

FILES CHANGED
- exact list

REPORTS
- exact paths

REMAINING LIMITATIONS
- exact list

============================================================
96. FINAL VERDICT
============================================================

Return EXACTLY ONE:

APARTMENT_ARCHITECTURAL_GEOMETRY_GATE_PASSED

APARTMENT_WALL_AND_SEGREGATION_GATE_PASSED_PDF_PENDING

APARTMENT_GEOMETRY_VALID_PDF_SCALE_PENDING

APARTMENT_BALCONY_QUALITY_PENDING

APARTMENT_GEOMETRY_HARD_ERRORS_REMAIN

APARTMENT_PDF_FIDELITY_FAILED

BUILD_ENVIRONMENT_BLOCKED

Do not commit.