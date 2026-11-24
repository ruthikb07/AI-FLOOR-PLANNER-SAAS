# BIM quantity verification

BIM Studio recomputes the active storey schedule from the current editor snapshot. The existing planar area ledger provides modeled unit carpet, room usable area and common circulation. Balcony area includes balcony rooms in the usable ledger. Gross area measures the canonical floor boundary. Built slab footprint measures the derived plate minus explicit voids. Apartment boundaries and modeled net totals remain separate.

Hosted opening schedules use canonical width and height. Straight-wall areas subtract the union of validated opening cuts. Wall volumes are per-element measurements, with no sum across shared junctions. No wall volume is reported where an opening or wall height is unresolved. Slab volume requires recorded slab thickness. Stair rows use canonical footprint and riser count. Wall material labels appear only where recorded in the source. Structural quantities and statutory areas require professional review.

`bim-studio.test.ts` verified an exact 40 mm opening-size change, unchanged modeled carpet, door count and deterministic window area. CSV prefixes spreadsheet formula-like text. The independent IFC run includes a window changed through the validated CAD editor. General quantity validation across partition undo/redo and every material assembly remains open.
