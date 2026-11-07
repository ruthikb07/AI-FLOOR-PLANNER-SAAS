# APARTMENT BALCONY EFFICIENCY REPORT
**Phase:** Master Phase: Apartment Architectural Geometry Closure  
**Component:** Balcony Spatial Utility, Usability Metrics & Planning Efficiency  
**Date:** October 2026  
**Status:** COMPLETE / VERIFIED  

---

## 1. Executive Summary

This report details the architectural design rules, usability criteria, and relative planning efficiency metrics governing residential balconies within the automated planning engine. Balconies in this phase are elevated from unmeasured exterior slivers to purposeful, physically bounded, and verified outdoor spaces. All efficiency comparisons in this document are framed strictly in terms of **relative architectural planning efficiency** (area utilization, aspect ratios, and circulation economy) and intentionally exclude construction cost or currency claims.

---

## 2. Balcony Classification & Ownership Model

Every balcony generated within an apartment floor plate is bound directly to a parent residential unit (`unitId`) and classified by functional typology:

| Balcony Typology | Parent Room Host | Primary Functional Purpose | Min. Usable Depth | Min. Clear Area | Parapet Specification |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Living Balcony** | `living_dining` | Social extension, natural ventilation, outdoor seating | $1500\text{ mm}$ ($1.50\text{ m}$) | $4.50\text{ m}^2$ | $115\text{ mm}$ masonry upstand, $1050\text{ mm}$ height |
| **Master Bed Balcony**| `master_bed` | Private morning terrace, cross-ventilation | $1200\text{ mm}$ ($1.20\text{ m}$) | $3.50\text{ m}^2$ | $115\text{ mm}$ masonry upstand, $1050\text{ mm}$ height |
| **Utility Balcony** | `kitchen` / `utility` | Service yard, laundry drying, condenser units | $1200\text{ mm}$ ($1.20\text{ m}$) | $2.50\text{ m}^2$ | $115\text{ mm}$ masonry with louvers / acoustic screen |

### Ownership & Access Invariants
1. **Direct Access Hosting:** Every balcony possesses at least one verified exterior door (`accessDoorIds`) opening directly from its designated parent room. Access via bathrooms, powder rooms, or circulation foyers is forbidden.
2. **Private Tenancy Boundary:** A balcony belongs exclusively to its parent unit. Communal balconies shared across separate flats are prohibited in private residential zones.

---

## 3. Dimensional Usability & Quality Standards

A balcony is classified as **ARCHITECTURALLY USABLE** only when it satisfies all of the following geometric conditions:

1. **Clear Depth Threshold:**
   $$D_{\text{usable}} \ge 1200\text{ mm} \quad (\text{Target: } 1500\text{ mm} \text{ for living balconies})$$
   Any outdoor projection with $D_{\text{usable}} < 1000\text{ mm}$ is classified as an unserviceable architectural ledge and rejected from the usable area ledger.
2. **Clear Width Threshold:**
   $$W_{\text{usable}} \ge 2400\text{ mm}$$
3. **Proportional Usability (Aspect Ratio):**
   $$1.2 \le \frac{W_{\text{usable}}}{D_{\text{usable}}} \le 3.0$$
   Excessively long and narrow balconies (e.g. $0.8\text{ m} \times 7.0\text{ m}$) are penalized due to poor furniture placement capacity.

---

## 4. Measured Golden Fixture Metrics

From the verified Golden 3 × 3BHK candidate (`output/apartment-geometry-closure/04-selected-candidates/golden/balconies.json`), the measured physical dimensions are:

| Metric | Flat 01 Living Balcony | Flat 02 Living Balcony | Flat 03 Living Balcony | Standard Requirement |
| :--- | :--- | :--- | :--- | :--- |
| **Balcony ID** | `flat_01_living_balcony` | `flat_02_living_balcony` | `flat_03_living_balcony` | Unique ID |
| **Usable Width ($W$)** | $3,070\text{ mm}$ ($3.07\text{ m}$) | $3,070\text{ mm}$ ($3.07\text{ m}$) | $3,070\text{ mm}$ ($3.07\text{ m}$) | $\ge 2,400\text{ mm}$ |
| **Usable Depth ($D$)** | $1,570\text{ mm}$ ($1.57\text{ m}$) | $1,570\text{ mm}$ ($1.57\text{ m}$) | $1,570\text{ mm}$ ($1.57\text{ m}$) | $\ge 1,200\text{ mm}$ |
| **Net Usable Area** | $4.82\text{ m}^2$ | $4.82\text{ m}^2$ | $4.82\text{ m}^2$ | $\ge 4.50\text{ m}^2$ |
| **Gross Area (with walls)**| $5.94\text{ m}^2$ | $5.94\text{ m}^2$ | $5.94\text{ m}^2$ | Measured |
| **Aspect Ratio ($W/D$)** | $1.96$ | $1.96$ | $1.96$ | $1.2 \le AR \le 3.0$ |
| **Direct Door Access** | `FLAT_01_door_6` | `FLAT_02_door_6` | `FLAT_03_door_6` | Verified |
| **Usability Verdict** | **PASS / HIGH UTILITY** | **PASS / HIGH UTILITY** | **PASS / HIGH UTILITY** | 100% Pass |

---

## 5. Anti-Fragmentation & Planning Efficiency

### Balcony Fragmentation Penalty
The optimization engine scores against spatial fragmentation:
- **Fragmented Layouts (Penalty):** Multiple small balconies (< $2.5\text{ m}^2$) increase perimeter wall length, add extra exterior weather doors, and consume valuable facade glazing without providing usable seating area.
- **Consolidated Layouts (Bonus):** Single generous living balconies ($\approx 4.8\text{ m}^2$) maximize outdoor amenity, provide space for 4-person table seating, and concentrate structural cantilevers.

### Relative Planning Efficiency Index
For the typical residential floor plate:
$$\text{Balcony Ratio} = \frac{\sum \text{Balcony Usable Area}}{\text{Floor Gross Area}} = \frac{14.46\text{ m}^2}{480.43\text{ m}^2} = 3.01\%$$

This $3.01\%$ allocation achieves an optimal balance between outdoor amenity and indoor living carpet area, complying with typical municipal FSI/FAR exemption caps (such as MCGM / PMC 3–5% balcony allowances) without eroding primary dwelling efficiency.
