# Screenshot defect repair — 13 November 2026

Status: PARTIALLY VERIFIED. Phase 1 acceptance remains open.

## Implemented

- Outdoor room labels take precedence over host-bedroom/kitchen words. Previously `Master Bedroom Balcony` matched `bed` first.
- Furnishing rejects indoor fixtures for canonical balconies and utilities, including legacy bedroom-typed records whose name identifies a balcony.
- The 2BHK master-bedroom door uses the internal passage instead of living/dining. Three dimension fixtures now explicitly check passage access for both bedrooms and absence of direct public-room doors.
- Core lift-depth rounding floors the allocation instead of rounding two cars beyond the available band. The elongated-plot production acceptance test now passes.
- Removed a misleading comment claiming verified bathroom ventilation from facade placement alone.

## Verification

- Planning suite: 534 passed, 3 failed (537 total); `test-artifacts/phase1-defects-full.log`.
- Focused classifier regressions: seven passed. Furniture integration: nine passed.
- Planning package typecheck, build and lint: passed after the final type-narrowing cleanup.

## Unresolved release gates

- Multi-storey production does not provide an accessible balcony for every bedroom. The topology assembler drops balconies that do not reach the floor-envelope facade; coverage is not complete.
- Decimal metric site scenario has a missing flat entrance/access failures.
- Production kitchen allocation fails the practical-area acceptance test.
- The legacy room slicer still allocates excess dimensions to bedrooms/living and can produce long bathrooms and oversized passages. This is not a complete room-proportion repair.
- Separate balcony partitions, actual wet-room ventilation openings, shaft effectiveness, and bedroom balcony exposure/clearances require end-to-end verification. No regulatory compliance is asserted.

Existing saved projects are not migrated by these changes. Generation must be rerun to exercise the solver changes; no browser result or deployment was verified in this repair pass.
