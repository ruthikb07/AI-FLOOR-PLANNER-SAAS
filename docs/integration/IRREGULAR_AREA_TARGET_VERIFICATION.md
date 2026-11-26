# Irregular-plot carpet area and strict alternatives

The original oblique fixture prioritized the inscribed plate and used substantially more buildable capacity than the advisory program requested. The solver now uses complete irregular-plot carpet targets to size the plate. It measures the canonical carpet ledger, adjusts plate capacity and unit shares separately, and retains a candidate only when its target error improves without increasing mandatory geometry blockers. Final optimization uses the measured wall, room and circulation geometry.

| Flat | Requested ft² | Baseline ft² | Phase 5.1 ft² | Remaining deviation |
| --- | ---: | ---: | ---: | ---: |
| 1 | 850 | 2,566.43 | 960.68 | +13.02% |
| 2 | 1,250 | 3,812.61 | 1,138.02 | −8.96% |

Both targets remain advisory misses. The acceptance test checks functional audit, planar conservation and an improvement to below 15% error for each flat. A strict request still uses its selected tolerance and refuses infeasible results.

| Strict alternative | Flat 1 ft² | Flat 2 ft² | Flat 3 ft² | Flat 4 ft² |
| --- | ---: | ---: | ---: | ---: |
| Requested | 720 | 1,050 | 1,420 | 1,750 |
| Original 42 × 34 m brief, South road | 718.35 | 1,033.75 | 1,436.86 | 1,702.15 |
| Independent 42.8 × 34 m brief, East road | 715.11 | 1,057.16 | 1,409.23 | 1,789.59 |

Each candidate came from seed 2 and passed the canonical meaningful-diversity comparison and all four 3% checks. The original Phase 5 replay correctly refused 819.4 ft² for Flat 1. Strict alternative generation now searches a window of at most four seeds with the original constraints and exclusion hashes. An exhausted search returns the number of attempted seeds and a refusal. Studio checks the actual site and locked footprints and cores before publishing an alternative. A full-project operation refuses when the editor has protected rooms, floors or cores. Local protected regeneration remains available within its supported scope.
