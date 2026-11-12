# ARGON 4 — Canonical Architectural Contracts & Invariants

**Author:** Lead Computational Architecture & TS Backend Engineer  
**Role:** Track A — Backend & Geometry Engines  
**Status:** CANONICAL BASELINE SPECIFICATION  
**Date:** November 2026  

---

## 1. Architectural Model Invariants

The ARGON 4 computational core enforces four mathematical invariants across all building layouts:

### 1.1 Zero Unassigned & Zero Overlap Planar Ledger Invariant
For any floor $F$ with boundary polygon $\mathcal{B}_F$ and room set $\mathcal{R}_F = \{R_1, R_2, \dots, R_n\}$:
$$\text{Area}(\mathcal{B}_F) = \sum_{i=1}^n \text{Area}(R_i) \iff \Delta = 0.000\text{ mm}^2$$
$$\forall i \ne j, \quad \text{Interior}(R_i) \cap \text{Interior}(R_j) = \emptyset$$
Any gap $> 100\text{ mm}^2$ triggers a critical `UNASSIGNED_AREA` error. Any overlap triggers a critical `ROOM_OVERLAP` error.

### 1.2 Multi-Level Core Continuity
Vertical circulation elements (staircases, lifts, lift lobbies, and MEP shafts) must maintain exact co-linear vertical alignment across all levels:
$$\forall F_a, F_b, \quad \text{Centroid}(\text{StairCore}_{F_a}) = \text{Centroid}(\text{StairCore}_{F_b})$$

---

## 2. Room Typing & Planning Zones

Rooms are strictly partitioned into four planning zones:

| Zone | Permitted Room Types | Privacy Level | Access Invariants |
| :--- | :--- | :--- | :--- |
| **PUBLIC** | `living`, `dining`, `foyer` | Low | Main unit entrance door must open directly into this zone. |
| **PRIVATE** | `bedroom`, `master_bedroom`, `study`, `pooja` | High | May NOT connect directly to common building corridors. Must open from internal passage or living room. |
| **SERVICE** | `kitchen`, `utility`, `bathroom`, `toilet` | Utility | Must have dedicated ventilation (exterior wall, shaft, or OTS). Attached bathrooms must share a wall with owner bedroom. |
| **CIRCULATION** | `corridor`, `internal_passage`, `lobby`, `staircase` | Neutral | Minimum width $\ge 1050\text{ mm}$ for common corridors, $\ge 900\text{ mm}$ for internal unit passages. |

---

## 3. Opening & Connection Contract

All doors and windows are first-class structural entities adhering to the following rules:

### 3.1 Door Hierarchy & Dimensions
1. **Primary Flat Entrance Door:**
   - **Width:** $\ge 1000\text{ mm}$ (typically $1050\text{ mm}$).
   - **Height:** $2100\text{ mm}$.
   - **Connection:** Strictly connects `COMMON corridor` to `PUBLIC room` (`foyer`, `living`, or `dining`).
   - **Rule:** Direct connection from common corridor to a private room (bedroom, toilet, kitchen) is strictly forbidden (`PRIMARY_ENTRANCE_PRIVATE_ROOM`).
2. **Habitable Bedroom Doors:**
   - **Width:** $\ge 900\text{ mm}$.
   - **Height:** $2100\text{ mm}$.
   - **Connection:** Opens from `internal_passage` or `living`.
3. **Bathroom & Service Doors:**
   - **Width:** $\ge 750\text{ mm}$ (statutory minimum $\ge 700\text{ mm}$).
   - **Height:** $2100\text{ mm}$.
   - **Master Bath:** Must connect exclusively to its owner bedroom.
   - **Common Bath:** Must open from `internal_passage`.
4. **Kitchen & Balcony Doors:**
   - **Kitchen:** $\ge 900\text{ mm}$ single swing or open threshold.
   - **Balcony:** $\ge 900\text{ mm}$ or $1200\text{ mm}$ sliding / french door.

### 3.2 Host Wall & Geometric Alignment
- Every opening must reference a valid host wall (`wallId`).
- The opening position must lie strictly on the host wall segment between its endpoints:
  $$\text{dist}(\mathbf{p}, \text{Segment}(\mathbf{w}_{\text{start}}, \mathbf{w}_{\text{end}})) \le 5\text{ mm}$$
- Clearance from wall corners must be $\ge 100\text{ mm}$ for structural masonry/concrete jambs.

---

## 4. Statutory Compliance Standards (NBC 2016 & UDCPR)

| Parameter | Statutory Minimum | ARGON 4 Metric Implementation |
| :--- | :--- | :--- |
| **Habitable Bedroom Min Area** | $9.5\text{ m}^2$ | $\ge 11.0\text{ m}^2$ |
| **Habitable Bedroom Min Width** | $2400\text{ mm}$ | $\ge 3000\text{ mm}$ |
| **Master Bedroom Min Area** | $11.0\text{ m}^2$ | $\ge 13.5\text{ m}^2$ |
| **Kitchen Min Area** | $5.0\text{ m}^2$ | $\ge 6.5\text{ m}^2$ |
| **Kitchen Min Width** | $1800\text{ mm}$ | $\ge 2400\text{ mm}$ |
| **Common Bath Min Area** | $1.8\text{ m}^2$ | $\ge 2.2\text{ m}^2$ |
| **Common Corridor Min Width** | $1000\text{ mm}$ | $\ge 1200\text{ mm}$ |
| **Floor-to-Ceiling Clear Height** | $2750\text{ mm}$ | $3000\text{ mm}$ floor-to-floor |

