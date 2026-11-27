# Milestone 6A structural topology

**PARTIAL · subphase 6A.1**

Recovered closure checkpoint `d242beb52491d125dc35a69e14b5dc03884325de` contains the 67 delivered files on base `548929820c9295b1368fea55ce3a316136e1d345`. Continue on `feat/structural-topology-and-coupled-analysis` in the non-synchronized worktree.

The internal worker implements planar deck coordination and returns a diagnostic floor model through POST /api/v1/structural/deck-topology. Supply the saved evaluationId and canonical building. The endpoint checks the architectural digest before reading physical beams from the selected evaluation. Each floor has beam and analytical child identities, beam footprints, deck regions and source opening rings.

## Replay

Use the pinned Python worker environment. Run the following from the repository root. The archive argument is the refined directory containing both apartment snapshots, architectural models and summary receipts.

    python -m pytest tools/structural-python-worker/tests -q
    python tools/structural-python-worker/replay_deck_topology.py <archive> docs/structural/6a-evidence
    pnpm --filter @ai-floor-planner/backend... run build

[Measured floor ledgers](6a-evidence/deck-replay.json) and [floor diagrams](6a-evidence/deck-review.html) are diagnostic. The current analysis, CAD and IFC still use the earlier slab model. The regeneration gate remains active.

## Next engineering dependency

Resolve which approved architectural surface is carried at each structural level, including setbacks at the next storey, terraces and stair landing geometry. The archived models place beam tops one storey height above each floor datum. A storey's plan extruded to that elevation is currently a candidate coverage assumption. Compare this against the approved deck at every transition. Establish connected beam ends, continuity, edge bearing widths, column and reviewed wall supports, and classify remaining unsupported regions. Only then select a load transfer method and replace room-based slab assembly. Coupled plate/frame force and moment benchmarks, stair transfer, final reactions, drift, foundation and reinforcement acceptance remain open.

## Production deck continuation

The production evaluator now accepts reviewed full-level rectangles before assembling loads. See [production verification](PRODUCTION_DECK_INTEGRATION_VERIFICATION.md) and [level ownership](DECK_LEVEL_AND_STAIR_OWNERSHIP.md). The original diagnostic replay remains preserved.
