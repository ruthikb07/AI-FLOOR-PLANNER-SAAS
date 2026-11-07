# Architectural constants audit

Source snapshot: D: workspace working tree, 2026-10-01. Units below follow each source file. `UNVERIFIED` means no independently checked office schedule or applicable regulation was established by this audit. A comment saying “code” or “statutory” is not verification. This inventory covers significant architectural constants; geometry tolerances and UI colors are excluded because they are not project requirements.

| Value | Source location | Purpose / current provenance | Safe as default? | Action |
|---|---|---|---|---|
| 50×50 m, North, 3/2/2/2 m setbacks | `packages/ai-orchestration/src/apartment/contract.ts:141-145` | General apartment contract fallback; Golden-like assumption | **No** for real projects | Require site facts; setback only if supplied or verified |
| 3 flats, 3BHK, 1100 ft² each | `contract.ts:186-197`; Golden wrapper `:245-277` | Unspecified contract/Golden fallback | **No** for generalization | Require count/mix; carpet target from user or approved office schedule |
| 1 lift for ≤2 flats, otherwise 2; 2 stairs; central compact bank | `contract.ts:213-221` | Core heuristic, not regulation | **No** for compliance | Separate user intent from verified required minimums; configurable |
| 3/2/2/2 m setback envelope | `apartment/site-defaults.ts:27-43` | Shared manifest/schematic/feasibility default | **No** for real site | Mark conceptual only; require verified or supplied constraints |
| 0 mm all setbacks; 0° north; North road; `cornerPlot=false` | `packages/core/src/models/factory.ts:227-253` | Canonical Site factory defaults | **No** unless explicitly confirmed | Preserve unknown state; do not convert absence into asserted zero/false |
| 3000 mm floor height; 230/150/100 mm walls; 900×2100 door; 1200×1200 window; 900 sill; 300×300 column; 175 riser/250 tread/1000 stair | `packages/core/src/constants.ts:7-24` | Generic architectural defaults, source not cited | Concept-only; column/structural claims **No** | Office schedule for walls/openings/heights; professional/rule review for access and stairs |
| Bedroom 9.5, master 12, kitchen 5, bath 2.5, living 12, dining 9, utility/dressing 3, foyer 3.5 m² etc. | `constants.ts:37-53` | Comment says Indian standards but no cited clause | **No** as statutory minima | Verify jurisdiction or label office heuristic |
| Bedroom 2700, master 3000, kitchen 2100, bath 1200, corridor/stair 900 mm etc. | `constants.ts:55-70` | Unverified minimum widths | **No** as statutory minima | Verified rule profile / office schedule |
| 1BHK 45 m² / 484 ft²; 2BHK 72 / 775; 3BHK 102 / 1100; 4BHK 145 / 1560 | `packages/ai-orchestration/src/apartment/program-registry.ts:58-62,166-170,313-317,489-493` | Built-in apartment program targets | Concept-only | Request office target/ranges; retain as visibly unverified fallback |
| 2BHK 70 m²; 3BHK 105 m² | `apartment/typologies.ts:82,121` | Separate typology targets conflicting with registry | **No** for one authoritative budget | Reconcile schedules before generalization |
| Unknown unit type falls back to 3BHK | `apartment/program-registry.ts:552-559` | Implicit typology coercion; `Studio` is in type union but absent from registry | **No** | Reject unsupported type explicitly; do not invent bedroom count/area |
| Studio 35, 1BHK 45, 2BHK 70, 3BHK 105, 4BHK 150 m²; unknown type 75 | `apartment/feasibility.ts:188-215` | Third area default set | **No** | Single approved schedule; unsupported type should not silently become 75 |
| Room min/target/max and min width for each 1–4BHK room | `apartment/program-registry.ts:14-37,55-551` | Hard-coded room schedule; `area-budget.ts:78-90` marks each line `UNVERIFIED` | **No** as code/office standard | Office area schedule plus verified regulatory floor; preserve range/provenance by unit type |
| 8% internal circulation, 12% wall allowance, balcony 50% in built-up | `apartment/area-budget.ts:108-115` | Budget proxies | Concept-only | Calibrate to office methodology; label gross/carpet definitions |
| 4.5 m²/lift, 14 m²/stair, lobby clamp 12–24 m² with 5 m²/flat, shafts max(3,1.5/flat), connector max(6,2.5/flat), 15 m² wall allowance, 10% plate margin | `apartment/area-budget.ts:151-194` | Feasibility proxies; not equipment schedules | **No** for approval | Source equipment dimensions/office methodology; compare actual geometry |
| Lift 2.1×2.1 m, stair 2.4×4.0 m, lobby depth 4.8 m, lobby width clamp 3.6–5.4 m | `apartment/core-optimizer.ts:89-94` | Core geometry heuristic; differs from area-budget proxy | **No** for compliance | Equipment and code schedule; reconcile geometry/area models |
| 2.8/3.0/3.2/4.0 m average entrance distance, 2–3 repeated wet stacks | `core-optimizer.ts:173-278` | Assigned option attributes, not measured routes/stacks | **No** as observed metrics | Compute from candidate geometry or label hypothesis |
| Cost score clamped 10–96 and ratio thresholds 6%, 9%, 12%, 18% | `core-optimizer.ts:292-396` | Relative architectural efficiency heuristic, not cost estimate | Only as explicitly named proxy | Calibrate on reviewed corpus; no cost claim |
| 2BHK widths 9.0–10.5 m; other type widths 11.0–12.8 m by strategy | `apartment/envelope-solver.ts:125-145` | Shape starting widths | Concept-only | Test broad area/aspect cases and office preferences |
| No-contract envelope fallback: 3 × 3BHK at 1100 ft² | `envelope-solver.ts:86-92` | Golden fixture-compatible fallback | **No** | Require contract for production path |
| Floor count × 3.1 m height; plate 90% of envelope; minimum envelope 65 m² | `apartment/feasibility.ts:106-130` | Simplifying geometry/capacity assumptions | **No** for regulation | Use actual floor heights/footprint; distinguish concept estimate |
| 5.5 m²/passenger lift, 6.5 service, 14 m²/stair minimum, 22/14 m² lobby, 1.8 m²/shaft, 10% circulation | `feasibility.ts:145-169` | Another core/circulation proxy set | **No** | Reconcile with contract budget and actual core geometry |
| 22 m²/car and 3 m²/two-wheeler; 42% core viability threshold | `feasibility.ts:224-252` | Parking and spatial heuristics | **No** as code/turning proof | Verified parking rules and geometric maneuver check |
| Default jurisdiction `pune_pmc` | `feasibility.ts:88`; backend `generation-orchestrator.ts:732` | Implicit legal context | **No** | Ask location; block code claims without verified profile |
| Numeric jurisdiction profiles and parking formulas | `apartment/jurisdiction.ts:110-760` | Source-string registry; no independent source check in this audit | **No** until verification | Capture exact adopted document, amendments, applicability and reviewer |
| 12% circulation, 6% wall allowance per floor | `packages/planning-engine/src/multi-floor/planner.ts:98-107` | General planner capacity proxy | Concept-only | Reconcile with apartment-specific 8/12 and 10% methods |
| 900/1050/750 mm doors; 1200 window; 150 mm clearance; 230/115 mm walls; 2100 door height | `planning-engine/src/generator/architectural-layout-engine.ts:49-53,1006-1155` | Generator-local sizes, inconsistent with core 150 internal wall | **No** for office drawings | Central approved wall/opening schedule; distinguish use cases |
| 1500 mm balcony, 1200×1500 OTS, parking/porch cutout formula | `planning-engine/src/generator/massing-generator.ts:92-150,188-189` | Site/massing heuristics | Concept-only | Office/site preference, site facts, and regulatory verification |
| Bedroom 1800×2100 symbol, living 2400×1800, kitchen 2400×1700, parking 1900×4700; nominal 200 mm edge clearance | `packages/renderer/src/reference-furniture.ts:5-27` | Illustrative graphics, explicitly not furnishing/maneuver certification | **No** for furnishability claim | Office furniture templates and clearance checks |
| 3000 floor-to-floor, 2700 wall, 150 slab, 900 parapet, default door/window heights | `packages/projection-3d/src/settings.ts:4-12` | Tagged `DEFAULT` 3D projection parameters | Only schematic 3D | User/office vertical schedule before Blender/elevations |
| A3, `1:100`, preset drawn-by/project/revision; PDF fit-to-page | `packages/frontend/src/services/advanced-export.ts:14-47,117-129` | Presentation defaults; actual fit scale independent of scale text | **No** for scale claim | Office sheet standards and calibrated PDF geometry |
| SVG wall/door/window/text styles | `packages/renderer/src/render-config.ts:123-255` | Renderer defaults | Concept-only | Office drawing standard; support explicit configuration |

## Complete apartment registry room schedule currently encoded

Source: `packages/ai-orchestration/src/apartment/program-registry.ts:55-551`. Columns are **min / target / max area in m²** and **minimum width in m**. Every line is a hard-coded, currently unverified program value (`area-budget.ts:78-90`); none is established here as an office or regulatory standard. 4BHK reuses 3BHK room definitions and adds `bedroom_4` (source `program-registry.ts:489-551`).

| Unit | Room ID | Min | Target | Max | Min width |
|---|---|---:|---:|---:|---:|
| 1BHK | foyer | 2.0 | 3.0 | 4.5 | 1.2 |
| 1BHK | living_dining | 16.0 | 19.5 | 24.0 | 3.0 |
| 1BHK | kitchen | 5.5 | 7.0 | 9.0 | 2.0 |
| 1BHK | utility | 1.8 | 2.5 | 3.5 | 1.0 |
| 1BHK | master_bedroom | 10.5 | 12.5 | 15.0 | 2.8 |
| 1BHK | common_toilet | 2.8 | 3.5 | 4.5 | 1.3 |
| 1BHK | balcony | 2.5 | 3.5 | 5.0 | 1.2 |
| 2BHK | foyer | 2.5 | 3.5 | 5.0 | 1.3 |
| 2BHK | living_dining | 20.0 | 24.5 | 30.0 | 3.3 |
| 2BHK | kitchen | 6.5 | 8.5 | 10.5 | 2.2 |
| 2BHK | utility | 2.0 | 3.0 | 4.5 | 1.2 |
| 2BHK | master_bedroom | 12.5 | 14.5 | 17.5 | 3.0 |
| 2BHK | master_toilet | 3.2 | 4.0 | 5.0 | 1.4 |
| 2BHK | bedroom_2 | 10.5 | 12.0 | 14.5 | 2.8 |
| 2BHK | common_toilet | 2.8 | 3.5 | 4.5 | 1.3 |
| 2BHK | living_balcony | 3.5 | 5.0 | 7.0 | 1.3 |
| 3BHK | foyer | 3.0 | 4.5 | 6.0 | 1.5 |
| 3BHK | living_dining | 22.0 | 28.0 | 36.0 | 3.6 |
| 3BHK | kitchen | 7.5 | 9.5 | 12.0 | 2.4 |
| 3BHK | utility | 2.5 | 3.5 | 5.0 | 1.2 |
| 3BHK | master_bedroom | 14.0 | 16.5 | 20.0 | 3.3 |
| 3BHK | master_toilet | 3.8 | 4.5 | 5.5 | 1.5 |
| 3BHK | bedroom_2 | 11.5 | 13.5 | 16.0 | 3.0 |
| 3BHK | toilet_2 | 3.2 | 4.0 | 5.0 | 1.4 |
| 3BHK | bedroom_3 | 10.5 | 12.0 | 14.5 | 3.0 |
| 3BHK | common_toilet | 2.8 | 3.5 | 4.5 | 1.3 |
| 3BHK | living_balcony | 4.5 | 6.0 | 8.0 | 1.5 |
| 4BHK | bedroom_4 added to 3BHK schedule | 10.5 | 12.0 | 14.5 | 3.0 |

This registry has no separate minimum-depth, preferred-aspect, or reviewed furniture-clearance values for each room. Those fields remain `CURRENTLY_UNKNOWN` and should be supplied by an office standard if the product uses them as constraints.

## Default policy

`NO DEFAULT — USER REQUIRED`: real site polygon/dimensions, north/road, residential subtype, floor count, flat count, unit mix, and project-specific approved constraints. `DERIVE FROM OFFICE STANDARD`: room targets, bathroom policy, wall/opening schedule, furniture, drawing conventions. `DERIVE FROM REGULATION DATABASE`: verified minimums, setbacks, FSI/coverage/height, parking, fire/egress, accessibility and environmental rules where applicable. `DERIVE FROM PRECEDENT`: topology and quality tendencies only. `AI MAY SUGGEST BUT USER MUST APPROVE`: preferences and ambiguous interpretation. `SAFE DEFAULT`: display name, visual colors, candidate seed, and clearly marked concept-only preferences; never silently promote them to approved facts.
