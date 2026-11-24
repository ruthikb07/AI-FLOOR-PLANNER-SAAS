# Phase 4 integration readiness

**Status** NOT READY for a production integration gate. The Phase 3 verification lists the remaining editor, rendering and export acceptance work. This document specifies the contracts future Cota and OpenBIMStudio adapters will need.

## Ownership and revision contract

The core `Building` model is authoritative. Use millimetres in the canonical geometry and explicitly document angle conventions, floor elevation, axis orientation and the origin. Derive the projected CAD, Three.js and Blender geometry from the same building revision. Keep canonical openings as explicit host references with their position convention, width, height and sill. Preserve straight and curved boundary geometry and internal slab voids. Structural members use a separately reviewed structural project. The preliminary column layout has concept status.

Adapter input should include the format and its version, source digest, input or measured units, coordinate transformation and tolerance policy. Requests that target an existing project also need project ID, building ID, expected revision and canonical digest, the target floor or zone, and the current protection state. New external identifiers need a deterministic mapping to canonical entity IDs. Retain the original identifiers and transform as provenance so revisions can be compared without guessing from positions.

## Import boundary

| Contract to implement | Acceptance evidence |
| --- | --- |
| Decode bounded source bytes with a declared format and unit conversion. Resolve ambiguous units in a measured preview. | Independent readback of dimensions and source unit metadata. Report missing layers and unsupported entities. |
| Resolve floor elevations, footprint and site boundaries, room/space ownership, wall hosts, openings, cores and circulation. Preserve ordered survey curves and voids. | Compare footprint, raw area ledger, storey alignment, wall ownership and access graph against canonical fixtures. |
| Produce a preview draft with source and canonical ID mappings, diagnostics and any lossy geometry transformations. | Show conflicts before applying. The shared schema and geometry gate runs on the proposed snapshot. |
| Apply an accepted import or edit as one revision on the expected base. | Reject stale edits and changes to locked geometry. Prove project identity, undo/redo and save/reopen against independently read bytes. |

## Export boundary

An export request pins project, building and version, canonical digest, format, units, drawing purpose and floor scope. The adapter returns bytes plus an artifact descriptor with size, MIME type, extension, revision, source and geometry checksums and verification status. Architectural sheets omit structural grids by default. Adapters should report exactly which entities were serialized, transformed or omitted.

Verify encoded format, coordinate scale, wall/host relationships, floor count, voids and named layer or class mappings through an independent parser or native reopen. Use fixture assertions for curved/shared walls, balconies, stairs, non-Latin labels, edited openings and locked geometry. Report software-format verification, native reopen, regulatory review and structural analysis as independent outcomes.

## Integration gates

- Agree on canonical mapping for site and storey axes, segment and arc topology, opening hosts, space ownership, stable external IDs, and provenance before enabling writeback.
- Complete the remaining Phase 3 browser and native evidence against the same pinned artifacts.
- Use real fixtures in each new adapter and capture an import → edit → export → independent reopen round trip. Compare exact revisions and canonical geometry using the tolerances declared by the adapter.
- Keep credentials and native execution in the backend. Use existing local or authenticated request boundaries and the durable project revision store.
