# Phase 3.5 release gate verification

Base revision `150a3164cb84cbe2942646ff32ce464f6795e20c`. The worktree was built outside OneDrive to avoid file locks. Source changes and generated artifacts are tracked separately.

## Live generation

The app used by the reporter at `127.0.0.1:4177` was served from the nested `feat/nextgen-solver-and-exports` checkout at `27d76d9`. Its backend was on port 4200. The repair preview ran on port 44327 with its own backend and project directory.

The legacy server took 51.1 seconds to return HTTP 200 with deterministic interpretation on a four-flat test brief specifying one lift, two stairs, no OTS and no balconies. The returned residential floor contained 12 balcony rooms. The initial repair build refused that seed-144 candidate at the acceptance gate after 48.7 seconds. The browser worker had a 45-second timeout and could start its own local solve before the server answered. It now gives the backend two minutes and identifies timeout, network and gateway fallback separately. A backend rejection or internal error is surfaced to the user.

The updated health endpoint performs a read-only Gemini credential probe. Its HTTP 200 verified the configured key against Google. The repaired service also received a structured Gemini response from `gemini-flash-lite-latest` on a generation request. The primary was intermittent, with both timeout and HTTP 503 observed. The aggregate account usage graph does not identify a particular local run.

The controlled full brief was `NO OTS. Center the building. One central lift and two stairs flanking it. No balconies.` The input used a 42,000 × 34,000 mm plot, four 2BHK flats, one typical floor plus stilt and roof, and seed 1. Both publications passed the mandatory gate.

| Live result | HTTP and interpretation | Residential geometry | Final physical fingerprint |
| --- | --- | --- | --- |
| Original study | 200 in 18.2 s. Deterministic interpretation after Gemini HTTP 503. | 58 rooms, 171 walls, 55 doors, one lift, two stairs, zero OTS rooms and zero balcony rooms | `layout:c2727781440db6dce9c86e617b3227e8df08477073a421a09ec7e24fd7036eeb` |
| Alternate excluding the original layout and topology | 200 in 24.7 s. Gemini reached the fallback model after a timeout. Its guidance failed the mandatory plan checks. The backend reran the original brief. | 58 rooms, 173 walls, 55 doors, one lift, two stairs, zero OTS rooms and zero balcony rooms | `layout:b76148f9833a235dce4b8100301bd314b02e5d35e910aba2f1169151532c5d93` |

The reporter confirmed using the older port 4177 and normal wizard inputs. A live Chromium run using the repaired wizard defaults returned HTTP 200 on Gemini’s fallback model, showed that model in Massing Studies and opened CAD without a page error. Its building had six levels, four flats and 73 rooms on the residential floor. The exact original wizard request was unavailable. Gemini supplies structured brief interpretation. The planning engine constructs, audits and publishes the canonical geometry.

## Editing and area checks

The partition solver moves a full shared straight edge inside one flat. It intersects the shifted axis with both original straight returns and preserves the envelope. It checks touched rooms and hosting, locked elements, other flats, the swept vicinity of columns, closure and recorded area targets. It supports skewed room edges in that domain and refuses a move that would shift a curved return, overwrite a third room boundary, or rotate a return. Topology changes requiring a free-form flat solve and direct curved-wall edits remain open.

Opening updates preserve IDs, ordering and unrelated host flags. New opening IDs are stable for identical revisions and edit parameters. The preview shows both sets of opening and wall positions and room area changes. Acceptance checks the live building and lock digest, then applies one exact snapshot. Advisory misses remain reported. Recorded strict targets and previously achieved targets reject an edit that moves them outside tolerance.

The backend generated regression measured a 50 mm rectangular shift and then a 25 mm normal shift of an oblique partition derived from the same canonical fixture. It checked unchanged floor outlines, preserved opening IDs, neighbour preservation and room closure. The original strict four-flat 2% fixture measured 703.75, 1,106.29, 1,500.71 and 1,900.80 sq ft against its target schedule in the same run.

## Unicode drawing and report PDFs

PDF drawings and compliance reports now use Fontkit shaping and embedded Noto Sans fonts. The drawing test used Marathi, Hindi, Bengali, Gujarati, Tamil and accented Latin. The renderer places glyphs using the shaped advances and offsets and supplies searchable Unicode text. The exporter rejects unsupported labels explicitly.

Independent PyMuPDF readback of the 1,514,669-byte drawing found nine pages and five extractable TrueType fonts. It found the Marathi and Hindi title and accented Latin on all nine pages, the Hindi room label on page 2, and Bengali, Gujarati and Tamil on pages 1–6. Page 1 rendered at 144 dpi. The PDF regression also reopens the document with pdf-lib and verifies the title, author, page count and embedded font maps. Licenses are packaged alongside the source fonts. [Noto font distribution](https://github.com/notofonts/notofonts.github.io/tree/682229039c5a594f247890d94e3fb497be8d58dd/fonts) · [Fontkit shaping](https://github.com/foliojs/fontkit)

## CAD and IFC boundary

The [adapter contract](../integration/PHASE4_CAD_BIM_ADAPTER_CONTRACT.md) records outbound mappings, revision and byte digests, stable IDs, hosts, units and local coordinates. The manifest fixtures check integrity and host pairing. Neither external implementation was located for revision or license review. Native IFC and external editor integration are pending.

## Browser and resource measurements

Chromium's SwiftShader run measured one render per frame during the tower orbit, 30 renders at pointer release and 34 after damping settled. The tower reported 183 draw calls and 164,714 triangles. A forced context-loss test reacquired the context and measured 112 geometry allocations after restoration against 114 before loss. The test now checks a fresh rendered frame and bounds allocations by the baseline. The showcase first-render sample reported 940 ms largest contentful paint and 0.038 cumulative layout shift on this test machine.

The legacy welcome tour passed with the current camera controls, photographic fallback and mobile launcher. The production walkthrough exposed missing credit, CAD inspector and accessible design-review entry points. The current implementation restores those entry points. Chromium exercised the inspector and review panel before the subsequent legacy walkthrough timed out on a visible 3D fixture control. The extended tower workflow also timed out during the resource run on this Windows host. The unverified browser assertions and 3D resource changes remain in the isolated Phase 3.5 worktree.

## Verification commands

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed in the isolated worktree. |
| `pnpm build` | 9 of 9 tasks passed. Vite reported a large-chunk warning. |
| `pnpm typecheck` | 16 of 16 tasks passed. |
| `pnpm lint` | 16 of 16 tasks passed in the isolated worktree. |
| `pnpm test:integration` | 21 passed. |
| `pnpm --filter @ai-floor-planner/backend test:integration` | 31 passed. |
| Focused generated geometry and PDF suites | 23 passed. A separate compliance PDF rerun passed all 6 cases. |
| Focused adapter contract | 2 passed. |
| `pnpm exec turbo run test --only --concurrency=2 --continue` | Eight packages reported 1,144 passing and eight pre-existing opt-in skips. The planning-engine benchmark was still running at handoff. |
| `pnpm --filter @ai-floor-planner/frontend exec playwright test --config playwright.repair.config.ts` | The broad run passed 16 of 18. The passed cases include the 40 mm hosted window edit, 50 mm partition move, revision protection, restore and CAD import. The two extended production cases remain open. |

A separate request to the production backend exported a ten-page Unicode PDF with HTTP 200. The native AutoCAD test independently audited 12 files with zero audit errors. Those native fixture results describe the format conversion checks for those fixtures.

## Release status

Phase 4 production integration is NOT READY. The extended browser runs, full planning benchmark, external source review and native exchange validation remain open. Direct edits of curved partitions and unrestricted flat replanning also remain open.
