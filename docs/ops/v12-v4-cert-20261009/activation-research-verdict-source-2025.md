# V12 Multi-Logic V4 – Best-Evidence Research Verdict (2026-10-09)

## Decision: BLOCKED_PRODUCTION_ROBUSTNESS / RESEARCH CONFIGS COMPARED, NOT LIVE CERTIFIED

This audit continues `docs/research/V12_V4_FORWARD_PRIORITY_GROSS_AUDIT_20261009.md`. All changes are **research-only**. This is NOT an instruction to raise gross, switch 41 route config, force orders, or deploy to VPS/Production. Keep the current Production unchanged.

**Critical new finding:** The previously selected high-expectation Y06 reversal (LONG source -> SHORT) fails a separate August–October 2026 route-edge holdout badly. Therefore the highest-profit one-year scenario is **not defensibly the best deployable strategy**. We are freezing this negative result and identifying a conditional, lower-risk research comparison, not hiding the loss.

## Primary question: Why did Y06 fall from 170 to 115 entries?

Compared two 10bps, accepted-leg portfolio ledgers:

- Second-pass repaired flat-gross: Y06 170 accepted.
- Train-only rank with midpoint gross caps: Y06 115 accepted.
- Key `(symbol, side, entry_ts_ms)`: **112 shared, 58 baseline-only, 3 newly accepted**.
- Of 58 baseline-only: **50 `V12:NO_GROSS_ROOM`**, 5 `V12:VENUE_MIN_QTY`, 3 `V12:VENUE_MIN_NOTIONAL`.
- The 58 lost entries in the baseline model were **48 wins, 10 losses**. This is a **retrospective** label, not an admissible real-time gate.
- Root cause: Gross reservations and venue min quantities, **not** primarily a stricter Entry predicate.
- Fixing Gross alone cannot create signals in the approximately 26% of hours when V12 has no open leg.

## 10bps development portfolio sensitivity

All have same train-only rank source `docs/research/results/v12-v4-priority-forward-split-20261009/training-only-priority.json` and same research caps (Recovery 1.5x, V12 2.5x, Crypto 3.25x, Total 4.5x) unless otherwise stated.

| Case | Final equity JPY | Max MTM DD | Accepted V12 trades | Y06 trades |
|---|---:|---:|---:|---:|
| Existing midpoint research reference | 158,468,411 | -18.98% | 754 | 115 |
| Y06 front rank, 0.60x | 157,194,939 | -18.98% | 751 | 116 |
| Y06 front rank, 0.50x | 151,376,237 | -17.75% | 763 | 122 |
| Y06 front rank, 0.40x | 145,126,553 | -17.06% | 773 | 127 |
| Y06 front rank, 0.30x | 147,533,740 | -16.69% | 796 | 141 |
| Y06 front rank, 0.40x, small-route cap | 99,779,080 | -18.26% | 783 | 135 |
| Y06 original train rank, 0.40x | 145,180,934 | -17.05% | 773 | 125 |
| **Y06 paused** | **145,111,702** | **-17.58%** | **695** | **0** |
| Y06 0.10x | 139,146,357 | -16.95% | 844 | positive |
| Five external-loss reversal routes paused | 81,796,835 | -20.04% | 646 | 0 |

Trade-off: reducing Y06 per-order size restores V12 opportunities and reduces one-year DD, but costs some one-year compounded profit. Pausing 5 reversal routes removes too many good development-period routes and worsens one-year drawdown.

## Cost stress (full multi-strategy modeled portfolio)

| Case | 20bps final JPY | 20bps DD | 30bps final JPY | 30bps DD |
|---|---:|---:|---:|---:|
| Midpoint 1.5/2.5/3.25/4.5 | 95,492,098 | -19.44% | 65,045,922 | -20.21% |
| Y06 0.30x first | 100,439,310 | -17.58% | 63,961,277 | -18.42% |
| Y06 0.50x first | 100,454,847 | -18.53% | 67,780,516 | -19.31% |
| **Y06 paused** | **98,534,666** | **-18.16%** | **66,330,201** | **-18.73%** |
| Y06 0.10x | 96,318,521 | -17.49% | 62,605,473 | -18.09% |
| Five weak reversal routes paused | 55,970,702 | -20.50% | 31,021,891 | -20.98% |

All 10/20/30bps jobs reported `ALL_SCENARIOS_ACCOUNTING_AND_DEPOSIT_AUDIT_PASS`; no historical fill verified at L2, only H1 price model.

**Important:** these one-year development simulations, including Y06 pausing, are in-sample for the selected route repairs and now partly post-selection. Better development portfolio DD does not establish the future stability of the risk model.

## External period – a serious failure incompatible with immediate LIVE promotion

Independent study: `docs/research/results/v12-multilogic-causal-holdout-20261009/causal-holdout-report.json`.

- Period: entries **2026-08-11 00:00 UTC to 2026-10-04 22:00 UTC**, H1 data through 2026-10-08.
- `COMPLETE_CAUSAL_MULTILOGIC_EXTERNAL_HOLDOUT`, **V12-only causal route candidates, BEFORE portfolio ownership, venue minimums and risk/cap orchestration**.
- Refetched Aster H1: 14/14 symbols had full 1704 H1 overlap, zero mismatches.
- Frozen V4 routes: **274 logic trades, 10bps WR 40.88%, PF 0.588**.
- Y06 specifically: **102 SHORT reversals, 10bps WR 37.25%, PF 0.2995, mean net return -3.01% per notional**.
- Y01: 16, WR12.5%, PF0.04; Y03: 16, WR43.8%, PF0.30; Y07: 12, WR25%, PF0.25; Y09: 14, WR28.6%, PF0.04.
- X09 (32, PF3.09), X10 (14, PF1.80), X14 (29, PF3.66) and Core (7, PF1.94) did better, but performance is uneven or sample size small; **do not choose newly enlarged risk based on these 55 days alone**.
- This external run is on frozen V4 routes, not the recently second-pass repaired overall entry set; however **Y06 entry/exit itself was not changed by the listed repairs**, so its failure is directly relevant.
- A source caveat records the period had been viewed earlier for older V12 work; label **post-selection external validation, not pristine project-level out-of-sample**. This is still material negative risk evidence.
- Applying Y06 pause to the development BT alone does **not** prove an external portfolio improvement because complete PENGU/Q102/FET/V52/funding data/ownership were not replayed for external period.

## Exploratory Y06 regime diagnosis (NOT a verified deployment gate)

Development accepted Y06 matched to causal source features:
- Train (exits before 2026-05-11): n150, WR73.3%, PF3.86.
- Development validation (entries after cutoff): n18, WR66.7%, PF3.07.
- Aug–Oct external: n102, WR37.3%, PF0.30.

BTC48 return <= +2%:
- Development train n34, WR67.6%, PF3.38.
- Validation n4 (insufficient).
- External n30, WR50.0%, PF0.90 — **still below 1**.

BTC48 <= +4%:
- Development train n104, WR72.1%, PF3.66.
- Validation n17, WR64.7%, PF2.65.
- External n43, WR48.8%, PF0.69 — **still below 1**.

BTC48 <= 0%:
- Development train n3, WR0%, PF0, insufficient.
- External n11, WR63.6%, PF1.99.
- It cannot be adopted because it leaves only 3 training examples and zero validation examples.

Conclusion: **no robust, causally supported Y06 continuation gate was found**. These BTC thresholds were inspected only as exploratory diagnostics after viewing external returns and cannot be promoted.

## Recommended decision

1. **Operational conclusion (the only robust decision): keep existing LIVE configuration unchanged; do not deploy V12 V4 / the new Gross allocations to live.** Mark `V12_V4_PROMOTION=BLOCKED_EXTERNAL_HOLDOUT_REGIME_SHIFT`.
2. **Development benchmark for yield/DD:** Y06 0.50x first / midpoint research caps has 10bps JPY151,376,237, DD-17.75%; 30bps DD-19.31%. It is **not LIVE-ready** because external Y06 negative.
3. **Risk-first hypothesis for next forward research:** temporarily pause Y06 new entries while retaining its shadow tracking. One-year 10bps JPY145,111,702, DD-17.58% and 30bps DD-18.73%. This remains **post-selection** and is NOT a certified optimized strategy. It trades fewer V12 legs (695 vs frozen 1015) and requires admission/ownership replay in a genuine external period.
4. Do NOT hard-disable all five hindsight poor reversal routes: development 10bps final equity drops to JPY81,796,835 and DD worsens to -20.04%.
5. Fix actual production parity blockers separately: route selection timing, collision ownership, net venue min-size, virtual-leg lifecycle, actual 5x Cross read-back, Gross reservation atomicity, crash/restart. No forced live order testing.
6. To declare a best deployable strategy: freeze feature/exit/priority/sizing rules BEFORE accumulating new unseen forward data; require independent temporal and regime coverage, cost/slippage stress, monthly attribution, PENGU/Q102/other strategy interference and <=20% DD even at realistic stressed costs, then operator-approved rollout.

## Reproduction files (research only)

New:
- `scripts/research/run_v12_v4_y06_protection_sweep.py`
- `scripts/research/run_v12_v4_y06_protection_stress.py`
- `scripts/research/run_v12_v4_external_caution_sensitivity.py`
- `docs/research/results/v12-v4-y06-opportunity-protection-20261009/{protocol.json,comparison-summary.json}`
- `docs/research/results/v12-v4-y06-protection-stress-20261009/{protocol.json,comparison-summary.json}`
- `docs/research/results/v12-v4-external-caution-sensitivity-20261009/{protocol.json,comparison-summary.json}`

Source:
- `docs/research/results/v12-multilogic-causal-holdout-20261009/causal-holdout-report.json`
- `docs/research/results/v12-multilogic-causal-holdout-20261009/causal-trades.jsonl`

No production deployment, no VPS actions, no HP code, no real orders.
