# PENGU V8 / IDLE TIA robustness audit — 2026-11-12

## Scope
Research only. Production, live runners, pinned source, orders, stops, and existing baseline outputs were not left modified. The STABLE3 and S3_HH_TH baseline directories were restored from hash-verified 21-file backups after each in-place A/B.

## PENGU RECOVERY_V8
Decision: **no new change**.

- Target integrated 30bps: 27 fills, 19W/8L, WR 70.37%, PF 1.853.
- Fresh broad pretarget proxy: 19 resolved candidates, 13W/6L, WR 68.42%, PF 2.073.
- The current BTC24 cap is harmful on both independent pretarget sets, but removing it in the target integrated replay is much worse: 30bps final JPY 1484977 -> 708951, DD -24.77% -> -44.37%.
- Pretarget-derived RSI6 delta cap 22 also fails target: it removes six winners and one loser.
- Therefore: retain current behavior; do not add RSI block and do not remove the existing BTC24 cap in this research pass. The independent-validation conflict remains documented.

## IDLE TIA
Early adverse exits (3/6/9h x 1/2/3/4%) produced zero train-qualified candidates. TIA 0.5x risk reduction was also rejected after integrated replay.

The robust entry candidate is **TIA BTC24 >= -2.0%**:
- Pretarget 30bps: 172 fills, WR 53.49%, PF 1.055 -> 120 fills, WR 59.17%, PF 1.198.
- Forward holdout: unchanged 7 fills, WR 42.86%, PF 0.916 (neutral veto; threshold was not moved to improve forward).
- STABLE3 integrated 30bps: final JPY 1484977 -> 1565929; DD -24.77% -> -24.57%; WR 59.60% -> 60.07%; PF 1.567 -> 1.597.
- TIA route 30bps: 18 fills, 11W/7L, PF 1.577 -> 13 fills, 9W/4L, PF 2.649.
- Integrated threshold sensitivity -1.9%, -2.0%, -2.1% yields identical final metrics/fill count, so the result is not a one-point threshold artifact.
- With the separate TAO 0.5x candidate, 30bps final JPY 1536510 -> 1650120, with DD unchanged at -24.57%.

Decision: **carry TIA BTC24 >= -2.0% forward as a research/adoption candidate. It is not deployed by this commit.**

## Reproducibility
See PENGU_V8_IDLE_TIA_ROBUSTNESS_20261112.json for input hashes, result hashes, script hashes, exact metrics, and sensitivity runs.
