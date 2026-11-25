# Exact surveyed generation

The original production request returned HTTP 422 `SURVEY_GENERATION_UNSUPPORTED` for a valid oblique survey. The supported production wizard and API now send ordered signed millimetre coordinates, one sweep and setback per edge, and the measured road-edge index. The API computes the site bounds, regulatory area, exact buildable polygon and road frontage from the measurement. It also accepts the survey contract without rectangular dimensions.

| Profile | Result |
| --- | --- |
| Straight oblique and convex surveyed polygons | Edge setbacks are clipped against the measured polygon. The measured site remains the canonical site. All storey boundaries must be inside the measured setback polygon. |
| Straight simple concave polygons | Supported when every resolved edge setback is zero. |
| Curved edges or concave nonzero setbacks | HTTP 422 with the unsupported profile and reason. Curved survey editing and survey DXF remain available. |
| Intersecting or duplicate vertices, invalid coordinates or frontage | HTTP 400 before generation. |
| Empty or unusable envelopes | Explicit refusal. Publication requires the finished Building to pass containment. |

The wizard retains metric, decimal, imperial fractional and bearing/length survey input with closure validation. Its exact DXF retains ordered points, arcs and road frontage. The architectural solver places an axis-aligned Building within the exact envelope. It currently places a single road access marker at the selected edge midpoint. Neither a custom entrance offset nor arbitrary curved or site-shaped massing is part of this profile.

A real Chromium run generated an oblique site with the first vertex at −125 mm east, opened the selected plan in CAD, saved it to disk, compared all returned and persisted vertices with the submitted survey, and reopened it in the browser. The observed plan has two apartments, exterior openings and a common approach to the central stair/lift. Its visible generation findings still call for professional review.

The backend regression includes signed fractional coordinates, a nonzero oblique setback, a zero-setback concavity and every resulting storey footprint. The independent IFC script compares the exported site polyline with the canonical survey to 0.001 mm, allowing the IFC axis and winding convention. Browser evidence remains under `%LOCALAPPDATA%/RHPlanner/phase5-1-20261125`.
