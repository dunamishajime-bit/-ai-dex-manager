# BT final completion checkpoint — 2026-11-11

Status: CURRENT RESEARCH PHASE COMPLETE / NO PRODUCTION CHANGE

## Scope

- Evaluation period: 2025-10-01 00:00 UTC <= t < 2026-10-01 00:00 UTC
- Initial capital: JPY 10,000
- Cost models: 10bps / 30bps
- Canonical current-implementation simulator SHA256:
  - eba62b627ae78929de28a3274e9afadaf5204af05527996c47ce7ef6b14018c6
- Canonical research A/B harness SHA256:
  - b8754f919b0577959308c8c33269177d78d2da05e6b4844658c75da827325666
- Current-implementation parity includes exact V4 active-adapter replay, current Q102 candidate body including HIGH_VOL, PENGU native lifecycle, FET/HYPE/IDLE, Shared Risk 7.5% sticky daily semantics, V52 5m daily-latch semantics and current effective gross/capacity controls.
- V11 full-year executable-book/microstructure evidence is unavailable and remains fail-closed omitted from the canonical baseline. V50 remains a price proxy rather than signed executable-book parity.

## Locked canonical current-implementation baseline

| Cost | Final JPY | Max DD | Fills | Win rate | PF |
|---|---:|---:|---:|---:|---:|
| 10bps | 887,336.06 | -56.3135% | 537 | 57.3557% | 1.2223 |
| 30bps | 321,161.96 | -63.1958% | 537 | 56.2384% | 1.1678 |

Canonical determinism was already locked with exact primary-artifact SHA matching.

## Best causally-supported research bundle

The best bundle that survives the current causal/pre-period checks remains **CAUSAL_THREE**:

1. IDLE JUP robust gate
   - features.rel24 >= -0.04089204262472046
   - features.volumeRatio >= 1.2568362211142174
2. PENGU Recovery V8 gate
   - btc24h <= 0.011611625094354983
3. Q102 FET gate
   - ret14 <= 0.048722800378429465

Target-period replay, without retuning these frozen thresholds:

| Cost | Final JPY | Max DD | Fills | Win rate | PF |
|---|---:|---:|---:|---:|---:|
| 10bps | 1,585,699.80 | -41.3525% | 540 | 59.6296% | 1.4313 |
| 30bps | 579,086.35 | -50.6043% | 539 | 58.2560% | 1.3223 |

Determinism: 42/42 artifacts exact SHA256 match for the locked causal A/B evidence.

## Additional research completed after CAUSAL_THREE

### IDLE TAO ATR17

Pre-target candidate:
- features.atrRatio <= 0.017

Integrated result as a fourth gate:
- 10bps: JPY 1,571,335.34 / DD -41.3525% / Win 59.4796% / PF 1.4287
- 30bps: JPY 576,122.07 / DD -50.6043% / Win 58.1006% / PF 1.3209

Decision: **REJECT**. It does not improve DD and slightly reduces equity, win rate and PF.

### PENGU SHORT_V20

Pre-target Binance proxy search produced no robust simple gate. The old target-year-derived V20 rule is not accepted as causal evidence.

Decision: **NO NEW V20 GATE**. Keep native behavior under the current research bundle.

### PENGU V64

A two-hour conditional LONG-to-SHORT candidate remains interesting, but its accepted sample is small and it still lacks enough fresh non-overlapping forward episodes.

Decision: **RESEARCH ONLY / NOT INCLUDED IN FINAL CAUSAL BUNDLE**.

### HYPE

- Pre-target Binance proxy: 39 candidates.
- June–July train looked materially better than August/September validation.
- Best train-only gates failed validation.
- True Aster forward 2026-10-01..2026-11-08 produced 0 eligible HYPE candidates.

Decision: **NO NEW HYPE GATE**. Do not force a complex rule from a small unstable proxy sample.

### V4

Current implementation is replayed exactly for parity, but no new V4 direction-flip improvement has passed the required causal/OOS standard.
- X05/X07/X11 remain research components only.
- Y06 remains unresolved.
- No V4 improvement candidate is added to CAUSAL_THREE.

### Q102 broader family research

A new target-independent family screen was run on the available S34 pre-period/forward ledgers using train-only quantile thresholds and one-/two-feature AND rules over ret14, strength and margin.

Input structure:
- train: 2025-03-22..2025-06-30
- validation: 2025-07..2025-08
- prehold: 2025-09
- forward falsification: 2026-10-01..2026-11-08

Result:
- MR robust candidates: 0
- REV robust candidates: 0
- PB robust candidates: 0
- BRK robust candidates: 0
- Total robust new Q102 family gates: **0**

Evidence SHA256:
- q102_family_pretarget_robust_gate_search_20261111.json
- 917c962f425050316d10ca9e7bdf917c1b8891db76e7c9e994d87ce541327e66

HIGH_VOL cannot be independently redesigned from a genuine pre-target production-equivalent sample because the current scanner is fail-closed until 2026-06-20 due the 5400-hour history requirement and FIL history availability. Do not tune HIGH_VOL from target-period losses alone.

## Remaining DD

CAUSAL_THREE 10bps maximum DD:
- peak: 2026-07-12 01:05 UTC
- trough: 2026-09-22 11:00 UTC
- DD: -41.3525%

Largest modeled strategy loss contribution in that window is Q102, followed by IDLE and HYPE. The additional causal searches above do not provide a safe new gate that materially reduces this DD without target-period tuning.

## Final decision for this BT phase

The **current BT/research phase is complete**.

- Canonical current implementation is locked and reproducible.
- The best currently supportable research bundle is CAUSAL_THREE.
- TAO fourth gate is rejected.
- New PENGU V20, HYPE, V4 and broader Q102 gates are not promoted.
- Current data does not support a further causal improvement without either overfitting the target year or relying on too-small / non-equivalent samples.

The owner targets of approximately 70% win rate and <=20% max DD are **not achieved**. This is a negative but important result: the remaining gap cannot be honestly closed from the current evidence by additional threshold mining.

Future improvement should resume only when there is genuinely new causal information, more forward episodes, or a new structural model idea. The current locked results should remain the comparison baseline for that work.

## Safety / Production

This work made no Production mutation:
- LIVE orders: 0
- cancels: 0
- position changes: 0
- STOP changes: 0
- Kill Switch changes: 0
- Production runner activation/deactivation: 0
