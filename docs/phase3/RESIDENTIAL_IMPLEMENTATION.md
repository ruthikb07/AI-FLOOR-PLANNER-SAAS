# Residential compliance and Vastu advisory implementation

The revised residential brief supersedes the earlier implementation stop recorded in RESIDENTIAL_BRIEF_REVIEW.md. Existing statutory rules and canonical geometry remain authoritative.

## Delivered

- Core exports residential authority/congestion/road-display-tier contracts, a residential view of UDCPRComplianceReport, and separate Vastu advisory contracts.
- `evaluateResidentialUDCPR` delegates all statutory evaluation to the existing measured engine. It returns the same revision hash, source registry, unknowns and exact unrounded FSI results. Potential includes maximum ancillary potential and does not establish purchased rights. Display road tiers never replace the source tables' additional 15m and 30m boundaries.
- The statutory evaluator checks designated stilt floors for flats/habitable enclosures and explicit below-beam clearance >=2400mm. Unclassified custom enclosures remain unverified. Floor-to-floor height is never substituted for clearance. Exemptions remain reviewed candidates.
- Soft-storey status is explicitly NOT_RUN: Requires ETABS / FEM stiffness analysis.
- `evaluateApartmentVastu` produces a separate VASTU_ADVISORY report with statutoryEffect NONE, canonical hash, revision and input north angle. It never changes the building or statutory results.
- Geometry-engine owns the north-frame transformation and 3x3 unit partition. True north is clockwise from canonical canvas-up. Master bedrooms require an explicit MASTER_BEDROOM tag; proximity/room size never assigns that role. Ambiguous ownership or missing required scoring facts leave the score unavailable. Missing puja receives no scoring credit.
- Advisory weights are kitchen 35%, master bedroom 35%, centre clearance 20%, toilet placement 10%. An existing puja contributes an additional 10% before normalisation. A severe NE/central toilet or central column/toilet intersection caps the advisory score at 44. These are transparent product preferences, not statutory or structural findings.

## Preserved uncertainty

Unknown values are nullable or NOT_VERIFIED rather than fabricated zeros or passing defaults. REGIONAL_PLAN is a supported authority classification; its highway/building-line and planning-authority/TDR applicability remain NOT_VERIFIED without the necessary context. Existing unsupported plot-edge/navigation cases remain unverified. Original NBC clause verification, current local amendments and balcony exemption permission are not inferred. A successful software gate is not a municipal compliance certificate.

## Verification

Twelve new focused cases cover 12m corporation/council FSI, source margins, stilt clearance boundaries, absent clearance, regional uncertainty, an actual corridor route exceeding 22.5m, north-frame rotations at 0/45/90 degrees, balanced/defective advisory layouts, missing master designation, invalid north and empty geometry. Tests are in packages/planning-engine/src/__tests__/residential-advisory.test.ts, following the package's configured test discovery.

All verification gates passed on their first attempt:

| Gate | Observed result |
| --- | --- |
| Production build, concurrency 1 | 9/9 tasks successful |
| Planning-engine tests, one worker | 365 passing tests across 46 files |
| Typecheck, concurrency 1 | 16/16 tasks successful |
| Full monorepo tests, concurrency 1 and one worker | 1,481 passing, seven existing opt-in skips, zero failures/errors; 18/18 tasks successful; no cached tasks |
| Lint, concurrency 1 | 16/16 tasks successful |

The original 1,469 passing-test baseline is preserved, with 12 new tests. Source diff whitespace checks passed for the new modules. Exact exit codes and per-package counts are retained in residential-logs/results.json and summary.json, with gate logs alongside them. Software verification demonstrates internal behavior only; professional review remains required.
