# Apartment load closure

| Archived architecture | Floors | Candidate regions | Candidate deck area | Historical unresolved slab paths | Historical unassigned DL / SDL / LL (kN) |
|---|---:|---:|---:|---:|---:|
| Original 8444eca9316d | 6 | 13 | 4198.400 m² | 647 | 12350.186 / 3941.219 / 7271.098 |
| Second a5bbe93eb95d | 4 | 13 | 2631.536 m² | 335 | 7490.788 / 2369.716 / 4364.259 |

The geometry replay gives zero area gap and overlap on all ten floors under the documented floor and opening assumptions. The gravity figures come from the archived evaluations. Reactions, utilization, drift, optimization, foundation and material quantities require a new, fully loaded analysis. See the [per-floor measurements and input file hashes](6a-evidence/deck-replay.json).

## Production deck continuation

Both exact apartment digests were replayed through the production HTTP regeneration endpoint. The original returned 647 and the second 335 unresolved slab sources. All slab DL, SDL and LL on these legacy sources remained unassigned. See [force ledger](COMPLETE_GRAVITY_TRANSFER_LEDGER.json) and [registered floor measurements](6a-evidence/registered-levels.json).
