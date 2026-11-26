# BIM performance and WebGL report

The production Windows Chromium desktop run measured 1,719 ms from BIM navigation through selection of the active storey. The verified 1,626,833-byte IFC download took 6,580 ms from click to local bytes. The worker reference import took 1,681 ms from choosing the file through the visible content digest. These are wall-clock browser observations, including the test runner and local transport.

The lazy BIM workspace chunk measured 20.48 kB minified and 7.27 kB gzip. Its CSS measured 1.87 kB and 0.82 kB gzip. The IFC worker script measured 34.26 kB minified and loads on import or coordination. Import transfers the input buffer. Clash checks run in the cancellable worker with storey and bounds filtering. Rejected non-overlapping objects no longer consume the narrow-phase comparison budget.

The BIM 3D viewport uses the existing Three.js component. The desktop run reported 20 draw calls and 28 geometry allocations on the isolated storey. Moving to Precision CAD removed the BIM canvas. The separate production WebGL suite checks real automatic restoration, stable views and context release. Comprehensive heap and GPU byte profiling and separate timing of geometry preparation are open.
