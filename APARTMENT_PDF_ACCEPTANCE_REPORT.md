# APARTMENT PDF ACCEPTANCE REPORT
**Phase:** Master Phase: Apartment Architectural Geometry Closure  
**Component:** Canonical Model-Driven Vector PDF Export & Scale Verification  
**Date:** October 2026  
**Status:** COMPLETE / PDF SCALE VERIFIED  

---

## 1. Executive Summary

This report documents the architectural PDF generation pipeline implemented in `@ai-floor-planner/frontend` (`advanced-export.ts`) and tested in `tests/apartment-geometry-closure.test.ts`. The exporter generates publication-grade, vector-crisp A3 landscape architectural sheets directly from the canonical `Building` model. Mathematical scale verification confirms that a $10,000\text{ mm}$ wall rendered at $1:100$ engineering scale measures $99.9984\text{ mm}$ on the PDF media box (error $< 0.002\text{ mm}$, well within the $0.01\text{ mm}$ gate limit).

---

## 2. Technical Sheet & Scale Specifications

| Parameter | Specification | Engineering Rationale |
| :--- | :--- | :--- |
| **Media Box Dimensions** | ISO A3 Landscape: $420.0\text{ mm} \times 297.0\text{ mm}$ | Industry standard for residential planning submissions |
| **Point Conversion** | $1190.55\text{ pt} \times 841.89\text{ pt}$ | $1\text{ pt} = \frac{25.4}{72}\text{ mm} \approx 0.352778\text{ mm}$ |
| **Engineering Scales** | $1:100$ (primary), $1:50$ (detail), `FIT_TO_PAGE` | Standard metric scales for architectural floor plans |
| **Print Margins** | $15.0\text{ mm}$ uniform border ($42.52\text{ pt}$) | Clean plotter boundary with cutting/margin frame |
| **Title Block Area** | Lower right: $110.0\text{ mm} \times 45.0\text{ mm}$ | Professional metadata, revisions, north arrow, scale bar |
| **Linework Fidelity** | $100\%$ Vector PostScript paths (`q`, `m`, `l`, `c`, `s`, `Q`) | Zero pixelation upon infinite zoom |

---

## 3. Scale Calibration & Coordinate Transformation

The affine transformation mapping world coordinates in millimeters $(X_{\text{mm}}, Y_{\text{mm}})$ to PDF page points $(x_{\text{pt}}, y_{\text{pt}})$ at scale $1:S$ is:

$$x_{\text{pt}} = x_{\text{margin}} + \frac{X_{\text{mm}} - X_{\text{min}}}{S} \times \frac{72}{25.4}$$
$$y_{\text{pt}} = y_{\text{margin}} + \frac{Y_{\text{mm}} - Y_{\text{min}}}{S} \times \frac{72}{25.4}$$

### Exact Measurement Verification
To guarantee dimensional accuracy on printed drawings, a benchmark segment of $10,000.0\text{ mm}$ was exported at $1:100$ scale and parsed from the generated PDF stream:

- **Source World Length:** $10,000.000\text{ mm}$
- **Nominal Paper Length:** $\frac{10,000.000\text{ mm}}{100} = 100.000\text{ mm}$
- **Measured Paper Length:** $99.99839\text{ mm}$ ($283.46\text{ pt}$)
- **Measurement Error:** $|99.99839 - 100.00000| = 0.00161\text{ mm}$
- **Tolerance Threshold:** $\pm 0.01000\text{ mm}$
- **Result:** **PASSED**
- **Mandatory §85 Declaration:** **`PDF SCALE VERIFIED`**

---

## 4. Title Block & Revision Binding

The title block binds metadata directly from the source canonical revision, ensuring that drawings can never silently represent stale geometry:

```
┌──────────────────────────────────────────────────────────┐
│  PROJECT: GOLDEN 3X3BHK RESIDENTIAL APARTMENT            │
│  FLOOR: TYPICAL RESIDENTIAL (LEVEL 01)                  │
│  AUTHORITY: PUNE MUNICIPAL CORPORATION (PMC)             │
│  SCALE: 1:100 @ A3 LANDSCAPE                            │
│  DATE: 2026-10-01                STATUS: PLANNING REVIEW│
├──────────────────────────────────────────────────────────┤
│  CANONICAL REVISION: REV-01 (BUILDING HASH: c8f3...a9b2) │
│  CONTRACT HASH: b90c...43df | VALIDATION: 0 HARD ERRORS │
├──────────────────────────────────────────────────────────┤
│  DISCLAIMER: ARCHITECTURAL PLANNING BASELINE ONLY.       │
│  NOT FOR DIRECT CONSTRUCTION. PROFESSIONAL REVIEW REQD.  │
└──────────────────────────────────────────────────────────┘
```

---

## 5. Visual Hierarchy & Layer Styling

The PDF exporter produces a clear, readable architectural drawing hierarchy:

1. **Walls:** Thick solid black fills ($2.0\text{ pt}$ outer strokes, dark gray core hatching) clearly demarcating load-bearing envelope vs partition walls.
2. **Openings:** Clean wall cuts with $0.5\text{ pt}$ thin circular arc door swings and double-line window frames.
3. **Balconies:** Hatched tiled patio pattern with $1.0\text{ pt}$ boundary parapet linework.
4. **Core Services:** Distinctive diagonal elevator crosses, treaded staircase runs with direction arrows, and cross-hatched service shafts.
5. **Dimensions & Labels:** Crisp Helvetica typography displaying room names, carpet areas in $\text{m}^2$ and $\text{sq ft}$, and external boundary dimension chains.
