# Phase 5 performance report

Windows production browser verification uses Chromium with SwiftShader and the repository's established test budgets. The baseline desktop workflow reached the CAD preview and timed out waiting for the result. Its trace showed an active canonical validation request. The test now awaits the actual API receipt before checking the preview UI.

The next desktop run reached BIM selection, Precision CAD, Tower 3D and the selection highlight, then showed that Cutaway enabled section clipping while leaving the furniture layer hidden. A subsequent run reached working furniture visibility and night lighting and received a successful disk save response. It timed out before the success message was visible. The Studio now publishes the receipt status before refreshing its project list.

An independent local WebGL run using the interim production build passed five real context restorations. Each returned a frame on restoration and the recorded geometry and texture counts remained stable. The suite also checked release when leaving workspaces or switching projects. Trace and environment evidence is in `%LOCALAPPDATA%/RHPlanner/phase5-codex-20261125`.

An extended orbit replay initially failed with a Windows `EBUSY` error while Node was opening the Playwright test loader. Hardware GPU profiling and exact-head repeated Windows orbit measurements remain outstanding.
