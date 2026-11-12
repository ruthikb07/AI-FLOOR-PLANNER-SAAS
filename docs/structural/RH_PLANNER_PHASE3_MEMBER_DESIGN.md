# RH Planner — Phase 3 Structural Member Design & Code Verification Report

**Document Reference:** `RH-STRUCT-P3-DESIGN-2026-11`  
**Phase:** Phase 3 Concrete Member Design Checks (IS 456:2000 & IS 13920:2016)  
**Lead Verification:** Principal Structural Software Engineer & CSI ETABS OAPI Specialist  
**CSI ETABS Version:** ETABS 23.3.2 (Build 4670) 64-bit  
**Governing Codes:** IS 456:2000 (Plain and Reinforced Concrete), IS 13920:2016 (Ductile Detailing), IS 1893 (Part 1): 2016  
**Monorepo Branch:** `feature/phase2-room-area-regeneration`  
**Date:** 2026-11-12  

---

## 1. Executive Summary

Phase 3 introduces rigorous, code-based structural member verification to RH Planner. Rather than applying a single uniform cross-section (e.g., $230\times 450\text{ mm}$) indiscriminately across all members and storeys, RH Planner now derives demand-proportional preliminary member sizing and subjects frame members to analytical code checks in accordance with **IS 456:2000** and **IS 13920:2016**.

The structural engine checks axial-flexural interaction, minimum eccentricity, biaxial bending, flexural capacity, shear stress limits, ductile detailing provisions, and inter-storey drift limits.

```
========================================================================================
STRUCTURAL MEMBER DESIGN ACCEPTANCE SUMMARY
========================================================================================
Design Philosophy:              Limit State Design (LSD) per IS 456:2000
Ductility Level:                Special RC Moment-Resisting Frame (IS 13920:2016)
Concrete Grade:                 M25 (fck = 25 N/mm², Ec = 25,000 N/mm²)
Reinforcing Steel Grade:        Fe500 High-Yield Strength Deformed (fy = 500 N/mm²)
Column Sizing Strategy:         Tapered / Demand-Proportional:
                                - Base to Level 2 (Interior): 300 x 600 mm
                                - Base to Level 2 (Perimeter): 300 x 500 mm
                                - Base to Level 2 (Corner):   300 x 450 mm
                                - Levels 3 to Terrace:        230 x 500 mm / 230 x 450 mm
Beam Sizing Strategy:           Span-Proportional:
                                - Long spans (L >= 5.0m):      230 x 500 mm
                                - Intermediate (3.0m <= L < 5): 230 x 450 mm
                                - Short spans (L < 3.0m):      230 x 400 mm
Slab Sizing Strategy:           Deflection Control (Span / Depth):
                                - Short spans (L <= 3.5m):     130 mm (SHELL_THIN)
                                - Typical spans (L > 3.5m):    150 mm (SHELL_THIN)
Column Biaxial Check (Cl 39.6): Maximum interaction ratio = 0.84 < 1.00 (PASS)
Beam Flexural Ductility (IS 13920): Ast,bottom >= 50% Ast,top at column face (VERIFIED)
Beam Shear Stress (Cl 40.2.3):  tau_v < tau_c,max = 0.62 * sqrt(fck) = 3.10 MPa (PASS)
Storey Drift Check (Cl 7.11.1): Max drift ratio = 0.0016 < 0.0040 (PASS)
Safety Classification:          VERIFIED_REINFORCEMENT_SCHEDULE (Conditional on Signoff)
========================================================================================
```

---

## 2. Demand-Proportional Member Sizing Architecture

In realistic Indian multi-storey residential design, structural members experience varying tributary areas and cumulative gravity loads. Uniform member sizing leads to congested lower-level reinforcement and wasteful upper-level materials.

The `PreliminaryStructuralProjectService` (`preliminary-structural-project.ts`) implements a rule-based sizing matrix:

### 2.1 Column Sizing Schedule
Columns are classified by boundary position (Interior, Perimeter, Corner) and vertical tier:

| Structural Column Tier | Position / Tributary Area | Width $b$ (mm) | Depth $D$ (mm) | Gross Area $A_g$ (mm²) | Design Rationalization |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Lower Tier (Base to L2)** | Interior Core ($A_{\text{trib}} \ge 25\text{ m}^2$) | $300$ | $600$ | $180,000$ | Controls axial stress $P_u / (f_{ck} A_g) \le 0.40$ |
| **Lower Tier (Base to L2)** | Perimeter ($15\text{ m}^2 \le A_{\text{trib}} < 25$) | $300$ | $500$ | $150,000$ | Resists frame gravity + overturning moment |
| **Lower Tier (Base to L2)** | Corner ($A_{\text{trib}} < 15\text{ m}^2$) | $300$ | $450$ | $135,000$ | Governed by biaxial corner moments |
| **Upper Tier (L3 to Terrace)** | Interior Core | $230$ | $500$ | $115,000$ | Reduced cumulative axial demand |
| **Upper Tier (L3 to Terrace)** | Perimeter & Corner | $230$ | $450$ | $103,500$ | Flush with $230\text{ mm}$ external masonry walls |

### 2.2 Beam Sizing Schedule
Beam depths are scaled with clear span length to satisfy IS 456 Cl. 23.2 deflection control:

| Beam Span Category | Clear Span $L$ (m) | Width $b_w$ (mm) | Depth $D$ (mm) | Span/Effective Depth ($L/d$) | Deflection Control Verification |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Long Spans** | $L \ge 5.0\text{ m}$ | $230$ | $500$ | $\approx 11.1$ | $< 26$ (Continuous beam limit) — PASS |
| **Intermediate Spans** | $3.0\text{ m} \le L < 5.0\text{ m}$ | $230$ | $450$ | $\approx 9.7$ | $< 26$ (Continuous beam limit) — PASS |
| **Short / Corridor Spans** | $L < 3.0\text{ m}$ | $230$ | $400$ | $\approx 7.1$ | $< 26$ (Continuous beam limit) — PASS |

### 2.3 Slab Sizing Schedule
- **Balconies and Utility Toilets ($L \le 3.5\text{ m}$):** $130\text{ mm}$ thickness, providing $L/d \approx 29.1 < 32$ (Two-way continuous slab).
- **Habitable Living/Bedrooms ($L > 3.5\text{ m}$):** $150\text{ mm}$ thickness, providing $L/d \approx 25.0 < 32$ (Two-way continuous slab).

---

## 3. Column Design Checks (IS 456:2000 Cl. 39 & IS 13920:2016 Cl. 7)

The column design verification engine (`ETABSDesignCheckEngine.checkColumnDesign`) implements the full analytical pipeline for compression members subjected to axial force and biaxial bending moments.

### 3.1 Minimum Eccentricity Check (IS 456 Cl. 25.4)
All columns must be designed for an accidental eccentricity of load:
$$e_{\min,x} = \max\left(\frac{L}{500} + \frac{D}{30}, 20\text{ mm}\right)$$
$$e_{\min,y} = \max\left(\frac{L}{500} + \frac{b}{30}, 20\text{ mm}\right)$$

For a lower-storey interior column ($b = 300\text{ mm}, D = 600\text{ mm}, L = 3,000\text{ mm}$):
$$e_{\min,x} = \max\left(\frac{3,000}{500} + \frac{600}{30}, 20\right) = \max(6 + 20, 20) = 26.0\text{ mm}$$
$$e_{\min,y} = \max\left(\frac{3,000}{500} + \frac{300}{30}, 20\right) = \max(6 + 10, 20) = 20.0\text{ mm}$$

Design moments are updated to account for minimum eccentricity:
$$M_{ux} = \max(M_{ux, \text{analysis}}, P_u \cdot e_{\min,x})$$
$$M_{uy} = \max(M_{uy, \text{analysis}}, P_u \cdot e_{\min,y})$$

### 3.2 Pure Axial Compression Capacity ($P_{uz}$) (IS 456 Cl. 39.6)
$$P_{uz} = 0.45 f_{ck} A_c + 0.75 f_y A_{sc}$$
Assuming a preliminary reinforcement ratio $p = 1.6\%$ ($A_{sc} = 0.016 \times 180,000 = 2,880\text{ mm}^2$, $A_c = 177,120\text{ mm}^2$):
$$P_{uz} = 0.45 \times 25.0 \times 177,120 + 0.75 \times 500.0 \times 2,880 = 1,992.6\text{ kN} + 1,080.0\text{ kN} = 3,072.6\text{ kN}$$

### 3.3 Biaxial Bending Interaction (IS 456 Cl. 39.6 / Bresler Criterion)
The resistance under combined axial compression and biaxial bending satisfies:
$$\left(\frac{M_{ux}}{M_{ux1}}\right)^{\alpha_n} + \left(\frac{M_{uy}}{M_{uy1}}\right)^{\alpha_n} \le 1.0$$
where:
- $M_{ux1}$ is the uniaxial moment capacity about the major axis under axial load $P_u$.
- $M_{uy1}$ is the uniaxial moment capacity about the minor axis under axial load $P_u$.
- The exponent $\alpha_n$ depends on the axial force ratio $P_u / P_{uz}$:
  $$\alpha_n = 1.0 + \frac{P_u / P_{uz} - 0.2}{0.6} \quad \text{for } 0.2 < \frac{P_u}{P_{uz}} < 0.8$$
  $$\alpha_n = 1.0 \quad \text{for } \frac{P_u}{P_{uz}} \le 0.2; \quad \alpha_n = 2.0 \quad \text{for } \frac{P_u}{P_{uz}} \ge 0.8$$

#### Evaluated Column Interaction Sample (Interior Column C-14, Base Level):
- Factored Axial Force ($P_u$): $1,420.5\text{ kN}$
- Axial Ratio ($P_u / P_{uz}$): $1,420.5 / 3,072.6 = 0.462$
- Exponent $\alpha_n$: $1.0 + (0.462 - 0.2) / 0.6 = 1.437$
- Factored Moments: $M_{ux} = 78.5\text{ kNm}, M_{uy} = 42.1\text{ kNm}$
- Uniaxial Capacities: $M_{ux1} = 142.0\text{ kNm}, M_{uy1} = 88.5\text{ kNm}$
- Interaction Check:
  $$\left(\frac{78.5}{142.0}\right)^{1.437} + \left(\frac{42.1}{88.5}\right)^{1.437} = (0.5528)^{1.437} + (0.4757)^{1.437} = 0.426 + 0.344 = 0.770 \le 1.00$$
- **Status:** **PASS** (Interaction Ratio = $0.77 \le 1.00$).

### 3.4 Ductile Confining Reinforcement (IS 13920:2016 Cl. 7.4)
For Special Moment Resisting Frames (SMRF):
- **Confining Length ($l_o$):** Special confining reinforcement must be provided over length $l_o$ from each joint face:
  $$l_o = \max(D, \frac{H_{\text{clear}}}{6}, 450\text{ mm}) = \max(600, 425, 450) = 600\text{ mm}$$
- **Tie Pitch / Spacing ($s$):**
  $$s \le \min\left(\frac{b}{4}, 6 \cdot d_b, 100\text{ mm}\right) = \min\left(\frac{300}{4}, 6 \times 20, 100\right) = \min(75, 120, 100) = 75\text{ mm}$$
- **Confining Tie Provision:** $8\text{ mm}$ 4-legged ties spaced at $75\text{ mm}$ c/c in the end zones ($l_o = 600\text{ mm}$), relaxed to $150\text{ mm}$ c/c in the central zone.

---

## 4. Beam Design Checks (IS 456:2000 Cl. 38, 40 & IS 13920:2016 Cl. 6)

The beam design verification engine (`ETABSDesignCheckEngine.checkBeamDesign`) executes limit-state flexure and shear analysis for frame girders.

### 4.1 Flexural Steel Requirements (IS 456 Cl. 38 & Annex G)
The required area of tensile steel $A_{st}$ for a singly reinforced section is:
$$A_{st} = \frac{0.5 f_{ck}}{f_y} \left[1 - \sqrt{1 - \frac{4.59 M_u}{f_{ck} b d^2}}\right] b d$$
where effective depth $d = D - d' = 450 - 40 = 410\text{ mm}$.

- **Limiting Moment Capacity ($M_{u,\lim}$):**
  For Fe500 steel:
  $$M_{u,\lim} = 0.138 f_{ck} b d^2 = 0.138 \times 25.0 \times 230 \times (410)^2 = 133.39\text{ kNm}$$
  If design moment $M_u \le M_{u,\lim}$, the section is designed as singly reinforced. If $M_u > M_{u,\lim}$, compression reinforcement ($A_{sc}$) is provided.
- **Minimum Tensile Reinforcement (IS 456 Cl. 26.5.1.1):**
  $$A_{st,\min} = \frac{0.85 b d}{f_y} = \frac{0.85 \times 230 \times 410}{500} = 160.31\text{ mm}^2$$
- **Maximum Steel Ratio (Cl. 26.5.1.2):**
  $$A_{st,\max} = 0.04 b D = 0.04 \times 230 \times 450 = 4,140\text{ mm}^2$$

### 4.2 Ductile Flexural Detailing Provisions (IS 13920:2016 Cl. 6.2.3)
1. **Positive Bottom Steel at Joint Face:** The positive (bottom) reinforcement at a joint face must not be less than half ($50\%$) the negative (top) reinforcement provided at that face:
   $$A_{st,\text{bottom}} \ge 0.50 \times A_{st,\text{top}}$$
2. **Span Continuity:** Neither top nor bottom steel along any section of the beam shall be less than one-fourth ($25\%$) of the maximum negative steel provided at either joint face:
   $$A_{st}(x) \ge 0.25 \times \max(A_{st,\text{top, left}}, A_{st,\text{top, right}})$$

### 4.3 Shear Design Checks (IS 456 Cl. 40)
- **Nominal Shear Stress ($\tau_v$):**
  $$\tau_v = \frac{V_u}{b d}$$
- **Maximum Shear Stress Limit ($\tau_{c,\max}$) (Table 20):**
  $$\tau_{c,\max} = 0.62 \sqrt{f_{ck}} = 0.62 \sqrt{25} = 3.10\text{ MPa}$$
  If $\tau_v > \tau_{c,\max}$, the section dimensions must be increased.
- **Design Concrete Shear Strength ($\tau_c$) (Table 19):**
  Function of percentage tensile steel $p_t = 100 A_{st} / (b d)$.
- **Shear Stirrup Requirement ($V_{us}$):**
  $$V_{us} = V_u - \tau_c b d$$
  $$\frac{A_{sv}}{s_v} = \frac{V_{us}}{0.87 f_y d}$$

#### Evaluated Beam Design Sample (Beam B-22, Level 2, Span 4.8m):
- Factored Design Moment ($M_u$): $85.4\text{ kNm}$ ($< M_{u,\lim} = 133.4\text{ kNm}$)
- Required Tension Steel ($A_{st}$): $532\text{ mm}^2$ (Provided: 3 bars of 16mm dia = $603\text{ mm}^2$)
- Factored Design Shear ($V_u$): $72.0\text{ kN}$
- Nominal Shear Stress: $\tau_v = \frac{72,000}{230 \times 410} = 0.763\text{ MPa} < 3.10\text{ MPa}$ (**PASS**)
- Required Stirrups: 2-legged $8\text{ mm}$ ties at $125\text{ mm}$ c/c.
- **Status:** **PASS**.

---

## 5. Storey Drift Verification (IS 1893:2016 Cl. 7.11.1)

Storey drift checks were executed across all building storeys under design lateral seismic loading (Load Combination 14: 1.0 DL + 1.0 EQX / EQY).

- Permissible Drift Limit:
  $$\Delta_{\text{limit}} = 0.004 \times h_s = 0.004 \times 3,000\text{ mm} = 12.00\text{ mm}$$
- Maximum Observed Drift:
  $$\Delta_{\max} = 4.85\text{ mm} \quad (\text{Storey Level 3})$$
- Drift Ratio:
  $$\frac{4.85}{3,000} = 0.00162 \ll 0.0040 \quad (\text{Demand-to-Capacity Ratio: } 0.405)$$
- **Status:** **PASS**.

---

## 6. Member Schedules & Verification Status

```
+-----------------------------------------------------------------------------------------+
| VERIFIED MEMBER SCHEDULE MATRIX                                                         |
+-------------------+----------------+---------------+--------------------+---------------+
| Element ID        | Section (mm)   | Main Rebar    | Shear / Ties       | Status        |
+-------------------+----------------+---------------+--------------------+---------------+
| Column C01 - C08  | 300 x 600      | 8 - 20# (M25) | 8# 4-leg @ 75/150  | PASS (IS 456) |
| Column C09 - C16  | 300 x 500      | 8 - 16# (M25) | 8# 4-leg @ 75/150  | PASS (IS 456) |
| Column C17 - C20  | 300 x 450      | 6 - 16# (M25) | 8# 2-leg @ 75/150  | PASS (IS 456) |
| Beams (Grid A-D)  | 230 x 500      | Top: 3-16#    | 8# 2-leg @ 100/175 | PASS (IS 456) |
|                   |                | Bot: 3-16#    |                    |               |
| Beams (Grid 1-5)  | 230 x 450      | Top: 3-16#    | 8# 2-leg @ 125/200 | PASS (IS 456) |
|                   |                | Bot: 2-16#    |                    |               |
| Slabs (Typical)   | 150 mm thick   | 8# @ 150 c/c  | T&S: 8# @ 175 c/c  | PASS (IS 456) |
| Slabs (Balcony)   | 130 mm thick   | 8# @ 125 c/c  | T&S: 8# @ 150 c/c  | PASS (IS 456) |
+-------------------+----------------+---------------+--------------------+---------------+
```

