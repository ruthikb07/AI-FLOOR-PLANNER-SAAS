# Awatif Milestone 5 acceptance

Antigravity's last committed structural checkpoint is `5bfdc9364300f118ff90d347a055bb362e018db3` on `feat/awatif-integrated-structural-engine`. This checkpoint includes the solver, canonical frame and loads, RCC and foundation design, detailing, and optimization. The Studio integration was recovered as local edits on that branch.

## Application workflow

Open **Structural CAD → Analysis** on a generated or saved project. The local backend evaluates the canonical Building and the Studio displays the results, design schedules, findings, and quantities. Select a load combination in **Frame Diagrams** to fetch member forces, reactions, and displacements. The Studio shows the measured solver backend and equilibrium outcome. A changed model or input set clears the displayed results until the new evaluation returns.

The foundation review requires site bearing capacity, foundation depth, soil unit weight, allowable settlement, and the geotechnical report reference. Missing geotechnical data gates foundation design. Superstructure load assumptions remain preliminary and appear in the Studio. The optimizer produces a separate evaluated structural revision while preserving the canonical architectural hash.

DXF, IFC4, PDF, and the assistant consume the same server-held evaluation as the active panel, including optimized results. IDs are local session handles for a bounded cache. An expired handle returns HTTP 409. Rerunning analysis refreshes the handle. The assistant always presents deterministic findings. An optional Gemini interpretation requires an explicit request and a configured provider.

## Local HTTP contract

| POST endpoint | Request | Result |
| --- | --- | --- |
| `/api/v1/structural/analyze` | `building`, `reviewedInputs`, optional `foundationPreference` | `evaluationId`, lifecycle, structural summary, case diagnostics |
| `/api/v1/structural/evaluation` | `evaluationId` | Cached structural summary |
| `/api/v1/structural/design` | `evaluationId`, `memberId` | Member design and its code checks |
| `/api/v1/structural/case` | `evaluationId`, `caseId`, optional `kind: "loadCase"` | Displacements, reactions, station forces, equilibrium, and diagnostics |
| `/api/v1/structural/optimize` | Analysis inputs, optional `mode` and `maxIterations` | Before and after summaries, global reanalysis trace, and an ID for the evaluated result |
| `/api/v1/structural/drawings` | `evaluationId`, `format` of `dxf`, `ifc`, or `pdf` | Download with `X-Structural-Source-Revision` |
| `/api/v1/structural/assistant` | `evaluationId`, `query`, optional `useAi` | Deterministic facts and optional separate interpretation |

DXF projects the storey framing, supported slab outlines, foundation, and complete BBS. PDF includes separate frame plans and paginated schedules. IFC4 uses stable product identifiers and the evaluated frame endpoints. It includes canonical architectural storey elevations and supported slab panel and footing geometry. Intersecting slab cutouts with unresolved profiles and stair-waist solids record omissions. Stair-waist reinforcement appears in the PDF schedule. Rigid mat foundations use `IfcSlab.BASESLAB`. [buildingSMART IFC4 footing specification](https://standards.buildingsmart.org/IFC/RELEASE/IFC4/ADD2/HTML/schema/ifcstructuralelementsdomain/lexical/ifcfooting.htm)

## Verification commands

- `pnpm build`, `pnpm typecheck`, `pnpm lint`
- `pnpm --filter @ai-floor-planner/structural-engine test`
- `pnpm --filter @ai-floor-planner/frontend run test:e2e:repair rh-gate2-structural-verification.spec.ts`
- `python scripts/verify-structural-ifc4.py <structural.ifc> <snapshot.json>` with IfcOpenShell and NumPy. Set `RH_STRUCTURAL_EVIDENCE_DIR` before the browser run to save the exchange files and the analysis snapshot.

The embedded application works with Gemini disabled and runs independently of native engineering apps. The larger generated apartment fixture exercised the explicit reference-solver fallback after a WASM `memory access out of bounds` error. One factorization serves all load cases on a given frame. The measured fixture had 1,296 nodes and 2,877 members. All 30 combinations met equilibrium tolerance. RCC checks failed, with maximum evaluated utilization of 14.521 in the baseline scenario. The independent analytical benchmarks exercise the compiled WASM path.

## Observed results

- Workspace build, typecheck, and lint passed. The structural suites passed 24 tests. Backend passed 278 with 10 opt-in cases skipped. Frontend passed 188 in a serial Windows replay after a concurrent jsdom dependency-resolution error.
- The 288-case production planning benchmark produced 288 plans. The unified Cota/OpenBIM and independent WebGL recovery Chromium tests passed.
- The production Chromium run passed on the 30 m x 40 m generated apartment fixture. It checked an empty geotechnical gate, the change from seismic Zone III to V, an evaluated foundation result after test data entry, load-combination selection, all three downloads, and the deterministic assistant.
- All 30 combinations met the equilibrium tolerance after entering the fixture's geotechnical data. The design returned 1,351 major or critical findings, a maximum evaluated utilization of 17.705, and a failed rigid-raft check.
- IfcOpenShell 0.8.4 compared 1,134 columns, 1,743 beams, 308 floor slabs, and one raft slab against the evaluated snapshot. It verified eight IFC storey records including the plinth and foundation, with 12 stair-waist solids recorded as omissions. Cota and RH Planner's reference IFC reader each reopened all 1,743 beams.
- A smaller G+2 benchmark executed two full-frame Awatif WASM optimizer iterations and preserved the architectural hash. IfcOpenShell reopened its 36 columns, 48 beams, three slabs, and nine footings.
- The apartment PDF contained 237 A3 pages and 8,128 BBS marks. Foundation, framing, and schedule sheets were visually sampled after adding compact plan keys and collision-aware labels.

## Engineering limits

The supported scope covers linear static frame analysis, study-level modal analysis, and equivalent static seismic analysis. Shells, shear walls, response spectrum, second-order and nonlinear response, and flexible soil interaction remain open. Complete structural acceptance requires a reviewed project model, independent verification of the relevant engineering checks, and licensed engineer sign-off. The captured project is a generated verification fixture.
