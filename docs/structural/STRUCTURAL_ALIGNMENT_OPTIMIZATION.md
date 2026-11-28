# Structural framing alignment preview

In Structural Studio, open **Framing alignment**, select a connected beam chain on the active floor and choose **Preview straight framing**. The backend resolves physical beams and column-top analytical joints from the saved evaluation and checks the canonical architecture digest. The preview preserves both endpoints, computes the intermediate perpendicular moves, applies each proposed translation to all lifts in its stack and reports added overlaps against registered room boundaries, voids and stair footprints. Stilt moves require parking review.

The original archive's stilt chain contains `BM_floor_stilt_00_27`, `BM_floor_stilt_00_29` and `BM_floor_stilt_00_31`. The four Y offsets from the first column are 0, 400, 400 and 700 mm. The fixed-end straight axis runs obliquely and would move the two middle stacks by 191.185 mm and 107.831 mm across 14 lifts. At stilt level, one translation adds 42,211 mm² of shaft overlap. The other adds 29,527 mm² of core lobby overlap and 24,331 mm² of shaft overlap. The preview flags both for parking review.

| Span order | Existing joint-centre span | Straight axis span |
|---|---:|---:|
| First | 4517.743 mm | 4513.696 mm |
| Second | 1800.000 mm | 1798.069 mm |
| Third | 8805.112 mm | 8804.452 mm |

The same straight line can pass through the existing sections in plan with eccentric joints. The preview flags the eccentric connection review and retains the original framing. This analysis does not establish adequate beam-seat width, reinforcement congestion, torsion, formwork economy, wall and door clearance or parking manoeuvres. Applying either alternative requires approval, a reviewed connection and a new fully loaded analysis. The chain algorithm uses the actual saved joints and has no apartment-specific numbers.
