# Master product data requirements audit

**Audit date:** 2026-10-01. **Authority:** this D: workspace checkout, current working tree on `main`, HEAD `7bdada9`. The tree was already dirty (222 tracked changes/deletions or untracked entries at preflight). This is a source audit, not architectural approval, statutory verification, or a release gate. No engine code was changed.

## Decision and scope

The next useful phase is **apartment engine generalization with trustworthy inputs and holdout acceptance**. The engine already holds canonical geometry and several deterministic estimators, but site facts, apartment program preferences, office standards, regulatory applicability, and reference approval are mixed with hard-coded assumptions. Inputs need provenance before outputs can be described as verified. Current V1 is residential architectural 2D, alternatives, multi-floor coordination, review/finalization, exports, canonical Blender architecture, and elevations; structural/MEP engineering, foundations, BOQ, and costing are post-V1 (`docs/ROADMAP.md`).

## Authority and confidence contract

The **Building** is authoritative for current geometry (`packages/core/src/types/building.ts:246`). A **reviewed Program** is authoritative for design intent, not proof of physical access (`space-program.ts:49-87`). The apartment contract hash is an integrity check over its selected fields, not proof that its input values were supplied or legally valid (`packages/ai-orchestration/src/apartment/contract.ts:88-122`). AI images, Gemini interpretations, scores, SVG, PDF, Three.js, and Blender meshes are advisory or projections until deterministically reconciled with a selected Building revision. A regulation string in source code is not an externally verified rule.

Use exactly these **source classes** per field: `USER_REQUIRED`, `USER_OPTIONAL`, `DERIVED_DETERMINISTICALLY`, `REFERENCE_DERIVED`, `OFFICE_STANDARD`, `REGULATION_VERIFIED`, `PROFESSIONAL_REVIEWED`, `AI_INTERPRETED`, `DEFAULT_ASSUMPTION`, `CURRENTLY_HARDCODED`, `CURRENTLY_UNKNOWN`, `NOT_REQUIRED_V1`, `POST_V1`. Use authority `AUTHORITATIVE`, `ADVISORY`, `HEURISTIC`, or `UNKNOWN`. Some current values have multiple stages: the table names the current source and the recommended final source. A typed field alone does not mean its value is present for every project.

Confidence should be recorded separately as `VERIFIED`, `USER_CONFIRMED`, `OFFICE_STANDARD`, `REFERENCE_DERIVED`, `AI_INFERRED`, `DEFAULT`, or `UNKNOWN`, with source ID, edition/time, reviewer, and affected revision. Current models only partly support this: Site controls have `USER_PROVIDED/NOT_CONFIGURED` (`building.ts:43-55`), Program has broad provenance (`space-program.ts:14,80-87`), Footprint has provenance (`footprint.ts:34-44`), room area lines say `UNVERIFIED` (`area-budget.ts:14-24`), and 3D settings carry `DEFAULT/USER_PROVIDED/DERIVED` (`projection-3d/src/settings.ts`). There is no uniform field-level provenance for Building geometry, jurisdiction rules, or finalization.

## Master data inventory

Legend: Present = schema/runtime evidence; `Y/P/N`. Source uses the classes above. Authority is **current** authority, not desired future authority. Default `—` means no meaningful default. Safe = safe for **unapproved concept exploration only**. U/D/R/Ref/Pro/V1/Post are whether user, deterministic derivation, verified regulation, reference, professional review, V1, or post-V1 is involved. `C` = conditional. All unverified numerical architectural defaults remain **heuristics**, even when a function calls them minimums. Source paths are relative to repository root.

| Field | Domain | Current type/source | Present | Current source | Authority | Current default | Safe | U | D | R | Ref | Pro | V1 | Post | Risk if missing | Recommended action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| project ID/name | identity | `building.ts:238-263`, `contract.ts:50-78` | Y | DERIVED_DETERMINISTICALLY / USER_OPTIONAL | AUTHORITATIVE for ID | generated ID/display name | Y | N | Y | N | N | N | Y | N | traceability | generate ID; display name optional |
| project type/subtype | identity | `space-program.ts:4`, `contract.ts:56` | P | USER_REQUIRED / CURRENTLY_HARDCODED | UNKNOWN | apartment typical | N | Y | N | N | N | N | Y | N | wrong workflow | explicit apartment/house and supported scope |
| location/jurisdiction | identity/rules | `jurisdiction.ts:10-15`; orchestrator `:732` | P | DEFAULT_ASSUMPTION | UNKNOWN | `pune_pmc` | N | Y | N | Y | N | C | Y | N | wrong rule profile | ask location; require verified profile before compliance claims |
| client name | identity | `building.ts:238-244` | P | USER_OPTIONAL | ADVISORY | — | Y | N | N | N | N | N | N | N | unnecessary PII | omit until title block needs it |
| design stage/review | identity | `building.ts:246-263`, closeout | P | CURRENTLY_UNKNOWN | UNKNOWN | concept | N | C | N | N | N | Y | Y | N | final used as draft | explicit draft/reviewed/finalized revision |
| plot polygon and units | site | `building.ts:81-104`; `factory.ts:222-242` | P | USER_REQUIRED / rectangle-derived | AUTHORITATIVE only if confirmed | rectangle from width/depth | C | Y | C | N | N | C | Y | N | false site boundary | request survey polygon for irregular sites |
| plot width/depth | site | `contract.ts:141-145`; `building.ts:81` | Y | USER_REQUIRED / DEFAULT_ASSUMPTION | UNKNOWN when defaulted | 50 m × 50 m contract | N | Y | N | N | N | N | Y | N | fictitious site | block generalization until supplied |
| north/orientation | site | `building.ts:87`; `factory.ts:246` | P | USER_REQUIRED / DEFAULT_ASSUMPTION | UNKNOWN when defaulted | 0° | N | Y | N | N | N | C | Y | N | misoriented design | user/survey confirmation |
| road edge(s)/width/access | site | `building.ts:91-99`; `contract.ts:145` | P | USER_REQUIRED / DEFAULT_ASSUMPTION | UNKNOWN when defaulted | North; width absent | N | Y | C | N | N | C | Y | N | wrong entry/parking | request road edge(s), width if known, entry constraints |
| corner plot/adjacent constraints | site | `building.ts:93-100` | P | USER_OPTIONAL | ADVISORY | false | C | C | N | C | N | C | Y | N | missed special envelope | ask if applicable; unknown is distinct from false |
| site levels/topography | site | no full survey model | N | CURRENTLY_UNKNOWN | UNKNOWN | — | N | C | N | C | N | Y | C | N | wrong access/levels | require for sloping site; otherwise mark unknown |
| setbacks | envelope | `building.ts:30-36`; `contract.ts:143`; `factory.ts:227-232` | Y | DEFAULT_ASSUMPTION / user | UNKNOWN when defaulted | 3/2/2/2 m contract; 0 mm factory | N | C | C | Y | N | C | Y | N | fictitious legal envelope | verified profile or labelled user-supplied design assumption |
| coverage/FSI/height limits | envelope | `building.ts:51-55` | P | USER_PROVIDED or CURRENTLY_UNKNOWN | UNKNOWN | absent | N | C | C | Y | N | C | C | N | impossible massing | attach jurisdiction, rule, edition, applicability |
| buildable envelope | envelope | `contract.ts:147-150`, `footprint.ts:67-81` | Y | DERIVED_DETERMINISTICALLY | HEURISTIC unless controls verified | rectangle after setbacks | C | N | Y | Y | N | C | Y | N | overstatement of legal buildability | keep distinct from boundary/target/actual footprint |
| target footprint/freedom | envelope | `footprint.ts:25-44`; `building-budget.ts:7-26` | P | USER_OPTIONAL / AUTO_FIT | ADVISORY | default footprint | C | C | Y | C | N | C | Y | N | wrong gross target | review budget and footprint freedom |
| actual floor plate | geometry | `building.ts:220-235` | Y | DERIVED_DETERMINISTICALLY/editor | AUTHORITATIVE for geometry | — | Y | N | Y | N | N | C | Y | N | export mismatch | bind to Building version |
| floor count/list/type | program | `building.ts:91,220`; `floor-configuration.ts` | P | USER_REQUIRED | AUTHORITATIVE if confirmed | typical floor | N | Y | C | C | N | C | Y | N | wrong unit totals/core | request G+N and per-floor differences |
| flat count/unit mix | program | `contract.ts:50-78,162-210` | Y | USER_REQUIRED / DEFAULT_ASSUMPTION | UNKNOWN when defaulted | 3 × 3BHK | N | Y | N | N | N | N | Y | N | wrong product | mandatory per typical floor |
| unit carpet targets | program | `contract.ts:68-76,168-197` | P | USER_OPTIONAL / OFFICE_STANDARD needed | HEURISTIC | registry defaults | C | C | C | N | C | C | Y | N | misleading feasibility | ask range or approved office schedule |
| room set/bath ownership | program | `program-registry.ts`; `space-program.ts:49-79` | P | CURRENTLY_HARDCODED / user | HEURISTIC | type presets | C | Y | C | N | Y | Y | Y | N | wrong mandatory rooms/private access | approve 1/2/3BHK policies; explicit bath owner/access |
| room area min/target/max/width | program | `program-registry.ts:14-37`; `constants.ts:37-70` | Y | CURRENTLY_HARDCODED | HEURISTIC | conflicting schedules | N | C | C | C | Y | Y | Y | N | weak/unverified standards | office schedule plus verified code floors |
| adjacency/privacy/zones | program | `program-registry.ts`, `space-program.ts:16-47` | P | CURRENTLY_HARDCODED / user | HEURISTIC | fixed graphs | C | C | C | N | Y | Y | Y | N | poor planning/access | distinguish hard access from soft preference |
| lift/stair counts/type | core | `contract.ts:215-221`; `jurisdiction.ts` | P | USER_REQUIRED or hard-coded | UNKNOWN when defaulted | 1/2 lifts, 2 stairs | N | C | C | Y | Y | Y | Y | N | wrong egress/core | request intent; verified rules govern required minima |
| lift/stair/lobby/shaft dimensions | core | `core-optimizer.ts:89-94`; `area-budget.ts:151-169` | Y | CURRENTLY_HARDCODED | HEURISTIC | 2.1 m lift, 2.4×4 stair etc. | N | C | C | Y | Y | Y | Y | N | noncompliant core/area | office equipment schedule and verified rules |
| corridor widths/travel distance | circulation | `constants.ts:67`; `core-optimizer.ts:173-278` | P | CURRENTLY_HARDCODED | HEURISTIC | 900 mm/2.8–4 m proxies | N | C | C | Y | Y | Y | Y | N | unsafe/false claim | distinguish computed path from assumed distance |
| furniture sizes/clearances | furnishing | `renderer/src/reference-furniture.ts:5-62` | P | CURRENTLY_HARDCODED | HEURISTIC | nominal symbols + 200 mm | C | C | C | N | Y | Y | Y | N | false furnishability | office furniture templates; symbols illustrative |
| exterior exposure/windows | environment | `envelope-solver.ts:39-45`; Building windows | P | DERIVED_DETERMINISTICALLY/heuristic | HEURISTIC | facade labels | N | C | C | Y | Y | Y | Y | N | false daylight claim | compute openings/shading/obstructions; review |
| wall types/thickness | geometry | `building.ts:133-147`; `constants.ts:8-10` | Y | CURRENTLY_HARDCODED | HEURISTIC | 230/150/100 mm | C | C | C | C | Y | Y | Y | N | wrong drawings/3D | office wall schedule; no structural claim |
| door/window schedule | geometry | `building.ts:150-178`; `constants.ts:12-17` | P | CURRENTLY_HARDCODED | HEURISTIC | 900×2100, 1200×1200 | C | C | C | Y | Y | Y | Y | N | unsupported 2D/elevations | office/project schedule with heights/sills/swings |
| parking counts/layout | site | `feasibility.ts:232-269`; SiteZone | P | CURRENTLY_HARDCODED/rules profile | HEURISTIC | 22 m²/car, 3 m²/two-wheeler | N | C | C | Y | Y | Y | Y | N | false compliance/maneuver | project brief + verified rules + geometry review |
| garden/drive/service zones | site | `building.ts:57-78`, site planner | P | USER_OPTIONAL/generated | ADVISORY | generated zones | C | C | C | C | Y | Y | Y | N | lost site intent | ask priorities, derive layout, review |
| typical/upper plates/voids | multi-floor | `footprint.ts:20-43`; floor model | P | USER_REQUIRED + DERIVED | HEURISTIC until reviewed | same-all-levels | C | Y | C | C | Y | Y | Y | N | missed terraces/duplex | floor-by-floor exception schedule |
| core/shaft/wet stacking | multi-floor | stair `verticalCoreId`; planner evidence | P | DERIVED_DETERMINISTICALLY | HEURISTIC | continuity checks | C | C | Y | Y | Y | Y | Y | N | uncoordinated floors | bind shared IDs and review wet zones |
| revision/finalization | review | `building.ts:246-255`; reviewed request hash | P | DERIVED_DETERMINISTICALLY / missing | UNKNOWN | Building.version only | N | C | Y | N | N | Y | Y | N | stale export/3D | exact Building+Program+rule+review identity |
| drawing standard/sheet | 2D | `renderer/src/render-config.ts:123-255`; export settings | P | CURRENTLY_HARDCODED | ADVISORY | default line/text styles, A3 1:100 | C | C | C | N | Y | Y | Y | N | office mismatch | office drawing template and scale verification |
| SVG/PDF/JSON | export | `frontend/src/services/advanced-export.ts` | Y | DERIVED_DETERMINISTICALLY | AUTHORITATIVE only as content | PDF fit-to-page | C | C | Y | N | N | Y | Y | N | scale/fidelity claim | round-trip/scale and revision tests |
| DXF/DWG | export | same export union `:11` | N | CURRENTLY_UNKNOWN | UNKNOWN | — | N | C | N | N | N | Y | Y | N | false release claim | implement later; external interoperability gate |
| 3D levels/materials | Blender | `projection-3d/src/settings.ts`; Blender script | P | DEFAULT_ASSUMPTION | HEURISTIC | 3000/2700/150/900 mm | C | C | C | N | Y | Y | Y | N | inaccurate model | reviewed height/opening/material schedule |
| facade/style | elevation | future dataset contract | P | USER_OPTIONAL | ADVISORY | — | Y | C | C | N | Y | Y | Y | N | unsupported presentation | ask at elevation phase |
| users/ownership/security | SaaS | `backend/src/server.ts:39-40,411-531` | N | CURRENTLY_UNKNOWN | UNKNOWN | wildcard CORS | N | Y | N | N | N | Y | Y | N | cross-project access/API cost | authentication, authorization, limits, storage |
| structural/MEP/soil/BOQ/cost | engineering | roadmap deferred | N | POST_V1 | UNKNOWN | — | N | N | N | C | N | Y | N | Y | false engineering claim | request only in later professional workflow |

## Architectural distinctions that must survive implementation

1. **Site boundary** is survey geometry. **Regulatory buildable envelope** is boundary minus verified applicable controls. **Target footprint** is requested massing. **Actual footprint** is canonical floor geometry. The rectangle subtraction in `contract.ts:147-150` is only a provisional capacity calculation and cannot establish a legal envelope for an irregular site.
2. Desired adjacency, bedroom ownership, and physical door access are separate. RBEA-001/002/003 fixtures show direct, private-indirect, shared, and ambiguous bath cases; labels/proximity cannot decide ownership.
3. `program-registry.ts` formalizes `PUBLIC/SERVICE/PRIVATE/OUTDOOR` within units; core/circulation are also represented elsewhere, but a single reviewed whole-building zone taxonomy is incomplete.
4. Facade availability is only an **opportunity**. Windows, obstructions, opening area, room depth, orientation, and professional review are needed before daylight/ventilation claims.
5. AI may suggest topology, arrangement, balcony position, furniture, or facade style. It must never invent site dimensions, roads, lawful setbacks/FSI/parking/stair/lift/fire requirements, approved floor count, structural/soil inputs, cost, or professional approval.

## Regulation and reference evidence

`constraint-engine/src/providers/regulatory-provider.ts` is an empty provider. A separate apartment `jurisdiction.ts:110-760` embeds numeric profiles and purported document/section citations, and `feasibility.ts:114-123,232-269` uses them. This audit did **not** independently verify editions, clauses, local applicability, or formulas against source documents; every rule is `CURRENTLY_UNVERIFIED` for external compliance purposes, not `REGULATION_VERIFIED`. User-supplied setbacks are `CURRENTLY_USER_SUPPLIED` only when explicitly entered and labelled as such; the code defaults are neither that nor verified law. Request the applicable authority, adopted edition/amendments, site classification, effective date, and clause/table scans or authoritative URLs for setbacks, coverage/FSI/height, parking, room/opening, access, stair/lift, fire, ventilation, and accessibility before using them as compliance gates.

The repo contains three distinct redacted **RBEA** reference fixtures (`planning-engine/src/__tests__/fixtures/RBEA-001..003.md`), all test-only, with source facts, ambiguity and provenance; none is a generation template. The backend reference tree holds **three distinct apartment PNG names**, repeated under `originals`, `normalized_512`, and several count buckets. Copies are not independent precedents, and no evidence here establishes approval/annotation for every bucket. A practical initial request is 10–20 distinct, permissioned, redacted residential plans spanning target typologies; that is a corpus design target, **not** a statistically established minimum. Keep at least 5–10 independent briefs/plans withheld from tuning, covering 2/3/4 flats, mixed 2/3BHK, wide/deep/square, changed frontage, one/two lift intent, and an infeasible case. Each needs site geometry/units/north/roads, approved floor count, unit schedule/area basis, core brief, source permission, redaction, and a reviewer verdict; optional detailed topology/opening annotations improve diagnostics.

References may inform topology, area ratios, circulation, public/private/service zoning, furniture and outdoor relationships. They must not establish legal rules, new-project coordinates, private ownership without access evidence, structural safety, or a client's brief. Books/research may later inform programming, graph planning, furnishability and drawing conventions, but remain advisory until adopted as reviewed office standards or verified regulations.

## Proposed data contracts (schema only; no invented values)

```yaml
OFFICE_ARCHITECTURAL_STANDARDS:
  standardId: string
  edition: string
  approvedBy: string
  approvedAt: date
  scope: [jurisdiction?, residentialSubtype?, unitType?]
  roomSchedule: [{spaceType, minArea?, targetArea?, maxArea?, minWidth?, minDepth?, preferredAspect?, sourceNote}]
  relationships: [{from, to, strength, accessRequired?, sourceNote}]
  walls: [{wallUse, thickness?, material?, sourceNote}]
  openings: [{use, width?, height?, sill?, swing?, sourceNote}]
  furniture: [{roomUse, item, width?, depth?, clearance?, sourceNote}]
  coreAndCirculation: {liftPreferences?, stairPreferences?, corridorPreferences?, bathPolicy?}
  siteAndOutdoor: {parkingPreferences?, balconyPreferences?, utilityPreferences?}
  drawing: {sheetSizes?, scales?, lineWeights?, layers?, symbols?, labels?, titleBlock?}
```

```yaml
REGULATION_PROFILE:
  jurisdiction: string
  authority: string
  document: string
  editionAndAmendments: string
  effectiveDate: date
  sourceUriOrDocumentId: string
  reviewer: string
  verificationState: UNVERIFIED | VERIFIED | SUPERSEDED
  projectApplicability: {siteClass?, occupancy?, heightBand?, roadClass?, plotAreaBand?}
  rules: [{ruleId, clause, parameter, value, unit, applicability, exception?, sourcePage, verifiedAt}]
```

```yaml
REFERENCE_PLAN_METADATA:
  sourceId: string
  permissionAndRedaction: {allowedUse, status}
  provenance: {fileHash, sourceType, verifiedBy?, verifiedAt?, confidence}
  project: {type, jurisdiction?, stage?}
  site: {polygon?, width?, depth?, north?, roads?, units?}
  floors: [{level, type, unitMix?, core?, spaces?, openings?, areaRatios?}]
  topology: {adjacency?, physicalAccess?, bathOwnership?, circulation?, outdoor?}
  qualityReview: {reviewer?, status, observations?}
```

OCR/vision may propose labels, dimensions, room polygons, openings, and adjacency. A reviewer must confirm units, access topology, ownership, legality of use, and ambiguous facts. Do not ingest names/title blocks/PII into fixtures.

## Immediate blockers and phase order

**P0 public deployment:** unauthenticated backend artifact/generation routes and wildcard CORS (`backend/src/server.ts:39-40,411-531`). **P1 design evidence:** implicit 50×50/default setbacks, unverified jurisdiction profiles, conflicting program defaults, unknown unit types silently mapped to 3BHK (`apartment/program-registry.ts:552-559`), Golden metric/report integrity, incomplete revision finalization, and insufficient independent holdouts. **P2 release quality:** PDF scale fidelity, absent DXF/DWG, office drawing schedule, Blender validation. **P3:** broader optional facade/material preferences and research corpus growth.

1. **Input provenance and generalization acceptance** — user supplies unit policy, area schedule, core intent, independent reference/holdout briefs; code can inventory/derive area and run current deterministic checks. Exit: missing required facts block, held-out cases report exact brief fidelity and failures.
2. **Architectural placement and alternatives** — depends on reviewed Program and holdouts; no new user data beyond targeted preference conflicts. Exit: meaningful, compliant alternatives with reviewed geometry.
3. **Multi-floor/site coordination** — user supplies floor exception schedule and site access facts; code derives floor budgets/core alignment. Exit: whole-building continuity and reviewed outdoor/void semantics.
4. **Professional 2D semantics/editor** — office supplies wall/opening/drawing standards; code projects canonical geometry. Exit: edit/save/reload and scaled sheet fidelity.
5. **Review/finalization identity** — reviewer selects exact Building+Program+rules revision; code invalidates stale outputs. Exit: exports/3D bind to immutable reviewed identity.
6. **PDF/DXF interoperability** — office supplies sheet/layer examples; code derives geometry and measures scale. Exit: external CAD/PDF round trips and honest format labels.
7. **Canonical Blender architectural bridge** — user supplies vertical dimensions/material choices where needed; code exports from finalized canonical revision. Exit: reproduced levels/openings/source IDs checked in Blender.
8. **Elevations and presentation** — user supplies facade preferences, code derives geometry; exit: views match finalized model and professional visual review.
9. **Public SaaS controls** — product owner supplies tenancy/retention policy; code implements auth, ownership, rate controls, storage and backup; exit: isolation/security verification.

No dates or professional certification are implied. The detailed user pack and phase matrix are in the companion audit files.
