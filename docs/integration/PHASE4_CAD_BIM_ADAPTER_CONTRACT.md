# Phase 4 CAD and BIM adapter contract

The outbound contract in `@ai-floor-planner/core` pins the canonical project ID, building ID, revision integer and full canonical SHA-256. It binds the exact artifact bytes by a separate SHA-256. The manifest records an external identifier for every in-scope element and records the canonical host wall of every door and window. The independent reader verifies this envelope before parsing the format.

## Local coordinates

RH plan coordinates use millimetres with X right and Y down. Exchange coordinates use millimetres in a building-local right-handed frame with Z up. Use `(x, -y, floorElevationMm)` in the same building origin for DXF and IFC. Reverse reflected polygon winding as needed. Map arc angles and sweep orientation through the same reflection. Store north and survey placement as explicit metadata when supplied. A format with unspecified unit, misplaced origin, or unsupported geometric semantics fails the corresponding verification.

| Canonical object | DXF mapping | IFC4X3_ADD2 mapping |
| --- | --- | --- |
| Floor | Named level group with elevation and closed footprint | IfcBuildingStorey with relative elevation |
| Wall | Centreline and thickness metadata, plus physical wall outline | IfcWall for physical walls with axis and body geometry |
| Room | Closed polygon or analytic arc loop with stable room attributes | IfcSpace with the level-relative boundary and room classification |
| Door | Host-linked opening interval and swing geometry | IfcDoor filling an IfcOpeningElement |
| Window | Host-linked opening interval with head and sill properties | IfcWindow filling an IfcOpeningElement |

Virtual boundaries require explicit classification as non-physical. Use `IfcRelVoidsElement` between an opening and its physical host and `IfcRelFillsElement` between the opening and its door or window. Keep the opening centre and width in canonical units and preserve door adjacency and window room ownership in the metadata. [buildingSMART IFC opening definition](https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/lexical/IfcOpeningElement.htm)

External IDs remain stable through revisions while the source floor, kind and canonical identifier survive. Persist the DXF handle registry and derive IFC GlobalIds from assigned persistent identities. Represent approximation and unsupported entities explicitly in readback. Initial pilot acceptance limits are 0.5 mm maximum endpoint or centre position error, 1 mm maximum arc deviation and 0.01 m² maximum closed-room area error. Require exact host and stable-ID correspondence. A native validator and representative CAD and IFC viewers must establish the final interoperability tolerances.

Limit pilot inputs to 25 MiB. Parse untrusted files in a constrained process with time and memory limits. Refuse external references, scripts and network retrieval during import. Verify units, origins, digests, IDs, host references and finite geometry before presenting any readback. The shared interface currently has outbound projection and readback only.

Cota and OpenBIMStudio source and license review remains pending. Before any dependency is accepted, pin the intended upstream revision, identify its license and dependent assets, and record redistribution and notice obligations. The contract tests use a local manifest fixture and exercise provenance, integrity and host mapping. They establish no native DXF/IFC certification.
