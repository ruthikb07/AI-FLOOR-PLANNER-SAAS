# BBS and BOQ reconciliation

The canonical report provides design steel mass, lap or splice mass, cutting mass, category and storey subtotals, concrete, formwork and excavation. A procurement allowance is advisory and separate from calculated cutting mass. The independent readback sums exported bar marks, checks their uniqueness, compares the total against the report and writes category CSVs directly from the canonical exported schedule.

The final 2,264 bar marks sum to 146,273.657514 kg, which rounds to the reported 146,273.66 kg. The ledger reports 1,589.08 m³ net concrete, 6,603 m² formwork and 1,824.20 m³ excavation for the captured architecture. The earlier two-decimal-per-mark export summed to 146,273.80 kg.

Arithmetic reconciliation covers the numeric schedules. Anchorage, detailing geometry, material choices and construction compliance require their own checks. The failed real case preserves its diagnostic classification through its headers and schedules. The legacy indicative INR total uses application defaults of ₹7,200/m³ structural concrete, ₹76/kg steel, ₹580/m² formwork, ₹340/m³ excavation and ₹5,200/m³ blinding. These are unreviewed placeholder rates.

[Reconciliation results and artifact SHA-256](../../../carbon4-evidence/recovery-20261127/deliverables-verification.json) · [Generated schedules and BOQ](../../../carbon4-evidence/recovery-20261127/frozen-production-deliverables/)
