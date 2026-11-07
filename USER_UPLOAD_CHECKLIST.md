# User upload checklist

Use permissioned, redacted files. Remove client names, phone numbers, addresses, signatures and title blocks unless a later contract explicitly requires them. Identify file units and source/reviewer where known. A blank field is `UNKNOWN`, not permission to guess.

## Upload now — apartment generalization

- [ ] One 1BHK/2BHK/3BHK **unit program and bathroom policy** (office schedule or annotated written list).
- [ ] One **area schedule** with carpet/built-up definitions and room target ranges. If no standard exists, provide the architect who will approve a provisional schedule.
- [ ] Five **independent holdout briefs** using `MINIMUM_NEXT_PHASE_DATA.md` (A: 3×3BHK, B: 4×2BHK, C: mixed 2/3BHK, D: narrow/deep 2×3BHK, E: deliberately difficult).
- [ ] Each holdout's **site evidence**: polygon/survey or dimensions with units, north, road edges/access, planned floor count, per-floor unit mix, and requested lift/stair counts.
- [ ] **3–5 distinct trusted apartment plans** initially, with permission to use, source description, units, and redaction. More may be supplied for a 10–20 plan calibration corpus. Copies of one plan in multiple buckets count once.
- [ ] Name the **review role/process** for architectural acceptance; no personal identifying details required in fixtures.

## Upload later — phase gates

- [ ] Floor-by-floor exception schedule: ground/typical/upper/terrace, duplex links, voids, balconies, parking, core and shaft continuity.
- [ ] Office wall and opening schedules, furniture templates and 2D drawing standard, including sheet/title block example.
- [ ] Actual PDF/DXF examples and preferred DXF units/layers/blocks/text/dimension conventions for export validation.
- [ ] Official regulation documents/URLs with edition, amendments, jurisdiction and a professional applicability review before any code-compliance claim.
- [ ] Finalization reviewer/signoff process and desired project revision metadata.
- [ ] Floor and opening heights, parapet/roof/balcony specifications, material/facade references when canonical Blender/elevation work begins.
- [ ] Public SaaS policy: account/organization ownership, sharing roles, retention, deletion, region, backup and provider budget limits when deployment is planned.

## Optional

- [ ] Additional precedents for rare topology, corner/irregular sites, parking/stilt, one/two lift configurations and orientation variations.
- [ ] Vastu, kitchen, pooja, balcony, garden and facade preferences. Omission means no stated preference.
- [ ] Nearby obstructions, survey levels and existing structures where they materially affect a specific site.

## Not needed for V1 architectural work

- [ ] Soil/geotechnical investigation, structural loads, member and reinforcement design, foundations, structural 3D, MEP load calculations, BOQ quantities/rates and construction costing. These belong to the post-V1 professional workflow, not this data request.

The software should calculate area budgets, floor capacity, candidate geometry, metrics and revision hashes from supplied facts. Do not ask the user to calculate them manually.
