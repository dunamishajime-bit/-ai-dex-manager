# PENGU SHORT_V20 causal pre-target audit — 2026-11-11

## Conclusion

Do not add a new SHORT_V20 entry gate.

The old V20 gate research used the target evaluation year itself (40 historical target-year SHORT_V20 trades split 20/20) and is not acceptable as causal evidence for the same target-year BT.

A new target-independent search was built instead and produced zero robust simple gates.

## Current-pin pre-target replay

- Data: Binance UM public PENGUUSDT/BTCUSDT H1 proxy, 2025-01-01 through 2025-09-30.
- Both normalized series: 6,552 continuous H1 bars.
- Exact current pinned SHORT_V20 state machine used for entry generation.
- Exact current pinned lifecycle functions used for exit replay.
- Fixed requested gross: 1.0x.
- Candidate count: 72.
- Unresolved lifecycle count: 0.
- Exit reasons:
  - SHORT_HARD_STOP: 32
  - SHORT_TRAILING_STOP: 16
  - SHORT_MAX_HOLD: 15
  - SHORT_V20_DEADLINE_EXIT: 9

## Causal split

- Train Jan-May: 50 trades.
- Validation Jun-Jul: 9 trades.
- Pre-holdout Aug-Sep: 13 trades.
- True Aster forward 2026-10-01 through 2026-11-08: 6 matched completed SHORT_V20 trades.

30bps baseline candidate quality:
- Train: WR 52.0%, mean +1.077%, PF 1.319.
- Validation: WR 55.6%, mean -0.106%, PF 0.962.
- Pre-holdout: WR 30.8%, mean -3.939%, PF 0.315.
- Forward: WR 33.3%, mean -0.777%, PF 0.573.

## Gate search

Thresholds were generated from TRAIN only.

Features intentionally restricted to the three fields also available in the untouched true-forward entry tape:
- pengu72h
- btc24h
- pengu72h minus btc24h

Tested:
- one-feature threshold rules
- two-feature combinations
- 121 qualifying train-derived candidate rules

Robust rules surviving train + validation + pre-holdout + forward: **0**.

No target-year trade or outcome was read to select a replacement rule.

## Decision

- Old target-year-derived V20 gate: reject as causal evidence.
- New pre-target simple gate search: no robust candidate.
- Do not force an additional SHORT_V20 gate.
- Keep CAUSAL_THREE unchanged.
- Move next to HYPE entry-quality research.

## Evidence SHA256

{
  "preProxy": "7b37ef15994e71512781c593bfa7083bc8c55b2a972e4ed273e821567cfa1803",
  "preManifest": "099fa7f67554d9b9f3c02b23e687d5894d877f0117a4cda652efb66034d85143",
  "preSearch": "3760d1869db44426fbfaf21d993888a4def5234618b69a96cacfff6c197a5aed",
  "oldTargetLeaky": "d0fa5cfafe2d23c9cecff94eb080ee338003e9479da3fde7b22be1e4ad58e924",
  "forwardRaw": "19d7425a44de6f861f0434ba6b0609fc6a81f82370c9f5221fe532fe0240d9fc",
  "forwardExit": "78ad200ad155e4682892a46eac7f2b7987e3d384ab31f44c920879f660039b13"
}
