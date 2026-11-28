# Archived apartment gravity reconciliation

The load-source replay validates the frozen architecture, summary and snapshot file digests before running the production gravity assembler on each saved physical system. The input file contains a Playwright geotechnical fixture reference. The replay excludes that site data and both lateral methods. No stiffness analysis is implied by this ledger.

| Archive | Historical unassigned DL / SDL / LL (kN) | Current unassigned DL / SDL / LL (kN) | Unresolved slab / stair sources |
|---|---|---|---|
| Original | 12350.186 / 3941.219 / 7271.098 | 13958.814 / 4135.619 / 7757.098 | 647 / 12 |
| Second | 7490.788 / 2369.716 / 4364.259 | 8562.926 / 2499.316 / 4688.260 | 335 / 8 |

The increase identifies weight previously attributed to proximity-selected beams. The class split now places structural stair concrete, finishes and imposed load in their respective cases. Roof surfaces without reviewed ownership remain outside these figures. The [source ledger](COMPLETE_LOAD_PATH_LEDGER.json) includes each receiving element and assigned force where available. Reproduce it with the locked vite-node runtime, passing the frozen archive directory and output JSON path to `scripts/replay-archive-gravity.mjs`.

**NOT READY** for real-project design. Neither archive supplies the mandatory project-specific roof, connection and site evidence. A complete coupled apartment solve, governing member checks, optimization, foundation acceptance and construction quantities remain open.
