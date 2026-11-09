# Y06 independent market-breadth validation — 2026-11-10

**Status: UNRESOLVED_DATA_OR_SEPARATION. Research only; no new rule accepted.**

## Provenance

- Repository: `dunamishajime-bit/-ai-dex-manager`
- Branch: `research/bt-direction-v4-pengu-q102-20261110`
- Research source runtime SHA: `3ad65403013b701db5d9e53e8814e6ab827a28e8`
- Target window: 2025-10-01 00:00 UTC–2026-10-01 00:00 UTC, exclusive end.
- Local dataset: `C:\tmp\disdex-bt-20251001-20261001\DIRECTION_RESEARCH_20261109`
- Reproducer: `scripts/y06-breadth-independent-validation-20261110.py`
- Machine-readable results: `results/v4_y06_breadth_independent_validation_20261110.json`
- These are route-level counterfactual raw returns, **not** 10/30bps integrated economics or actual venue fills.

## First: classify the raw signal, not a chosen subset

REC_Y06_REV_D0_T72 has **352 TARGET cases, all native SHORT**, at 280 distinct entry hours.
`wrong_native` is whether the modeled opposite side is better under the saved lifecycle; it is NOT the same as a certified actual profitable fill.

| Chronological split | Cases | Opposite side better | Rate |
|---|---:|---:|---:|
| Train | 211 | 39 | 18.5% |
| Validation | 70 | 33 | 47.1% |
| Unseen test | 71 | 48 | 67.6% |

The dramatic base-rate drift is itself a risk. Reusing a pooled cutoff across periods is not stable evidence.

## Independent data and no-leakage check

Read original compressed Aster public H1 data independently for **30 non-BTC crypto symbols**, then recomputed market breadth using ONLY closes of completed candles: last open timestamp = decisionTs − 1h; comparison close at decisionTs − (h + 1)h.

Across **352 Y06 events × 8 fields = 2,816** comparisons (positive breadth and arithmetic mean at 3/6/12/24h), saved cache matched **within 1.39e−17 maximum absolute error**, effectively exact float parity. The checked H1 feature rows use no unclosed current bar.

To avoid training on hindsight outcomes not yet available at the next decision, source labels are treated as fully settled only after **72 hours**. Training used 208/211 mature cases; calibration used 54/70 mature validation cases before unseen-test start. The 16 immature validation cases are retained for validation scoring, but not cutoff selection.

## Two fixed, deterministic model comparisons

Both models use class-balanced ridge logistic regression with penalty 0.25 and fit on the mature train subset. The breadth model adds only `breadth_pos6`, `breadth_pos12`, `breadth_pos24` to the six native entry features. Calibration cutoff is derived from mature validation cases, never from test labels.

| Metric | Six native features | Native + breadth |
|---|---:|---:|
| Validation ROC AUC | 0.381 | 0.329 |
| Validation flagged / beneficial / harmful | 5 / 0 / 5 | 5 / 0 / 5 |
| Unseen test ROC AUC | 0.632 | 0.654 |
| Unseen test flagged / beneficial / harmful | 7 / 6 / 1 | 4 / 3 / 1 |
| Unseen test with cutoff lowered 5% | 13 / 10 / 3 | 7 / 6 / 1 |
| Unseen test with cutoff raised 5% | 4 / 4 / 0 | 2 / 2 / 0 |

The apparent test precision at stricter cutoff has tiny support and cannot rescue the validation result. This experiment is explicitly **not a candidate-selection endorsement**.

A breadth-only comparator (12h positive breadth ≥ 70%) is even less stable: Train **31 beneficial / 125 harmful**; validation **21 / 26**; test **35 / 13**. Do not promote it.

## Independent second-pass interpretation

- Historical Y06 trade outcomes are heavily time-dependent; route-specific fixed cutoffs do not extrapolate reliably.
- Independent breadth-source arithmetic parity PASSED, and completed-bar alignment PASSED.
- Data fitness remains limited by temporal outcome imbalance, clustered timestamps and reused research holdouts. Breadth consistency is not a guarantee of direction correctness.
- Both static models FAIL the strict zero/near-zero harmed-correct-trade rule on validation and test.
- No re-tuned threshold or new Y06 Gate is accepted. Production, STOP, positions, gross, and order permissions remain untouched.
- Do **not** claim an integrated 10bps/30bps max-DD improvement from these route-level results. No new integrated BT was run because no rule qualified.

## Other V4 status retained from prior controlling classification

- **X05:** `vol72 <= 0.00658 AND sym_ret6 > 0` gave 1/1 train, 2/2 validation, 1/1 test beneficial at zero observed FP. Four selected events are insufficient and bearish synthetic counterexamples remain relevant.
- **X07:** adding absolute 6h symbol growth caused validation/test selections to fall to zero. Unresolved.
- **X11:** `rel72 > 0 AND sym_ret12 > 0` gave 2/2 train, 1/1 validation, 1/1 test. Relative-strength cutoff jitter to +0.5 percentage points eliminates validation and test events; to −0.5 percentage points introduces validation FP. Unresolved.
- PENGU V8's earlier seven-selected-case success is superseded by full 50 feasible cases (21 beneficial / 29 harmful). V64 2h is a research candidate, not a production change.

## Next evidence to collect

Collect genuinely new **decision-time** predictors or later independent OOS cases before attempting another Y06 classifier. Avoid re-searching the same TARGET labels until they appear perfect. Preserve route-by-route FP and DD evidence, then run integrated 10bps/30bps only for a qualified causal candidate, per `docs/research/DISDEX_BT_VALIDATION_PROTOCOL.md`.

## Reproducibility and checksums

- Script SHA256: `03c1312e4b792bd8a9ea9526ab0c54794d386a8531d04cec150362b316d3e6e6`
- Results JSON SHA256: `33181cb1f91bfba0e9191fb4355574a1652f28c48c3ff5cb1f4dd44b655a1e1e`
- Labeled source SHA256: `787643c815e11b36e4175d5230c015e68a8a61974aa1ab9e0b64ed305c946921`
- Breadth-cache SHA256: `61f1c81753dee36e2a47b4b525597cb7c2f5f46b28182d0d7218280298fb82cd`
- H1 30-file name/hash manifest digest: `d46b2f5c2c655b5ed84d5d1d08f94bfec8372e8eef3c5ec72cc89decae110713`

Run on the authorized PC where the local data are installed:

```powershell
$env:DISDEX_BT_ROOT='C:\tmp\disdex-bt-20251001-20261001'
python research\bt-direction-v4-pengu-q102-20261110\scripts\y06-breadth-independent-validation-20261110.py
```

The script does no GitHub, VPS or venue writes; it outputs a local audit JSON.
