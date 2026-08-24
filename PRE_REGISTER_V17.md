# PENGU Short V17 pre-registration

RESEARCH ONLY. No LIVE/VPS/orders/production changes.

## Candidate
`COUNTERWIND_STRUCTURAL_RECLAIM_PROBATION`

Exactly one candidate. No threshold sweep and no parameter search.

## Diagnosis that motivates V17
The frozen V16 Gate Q3 decision diagnostic identified the shared 2026-02-20 04:00 UTC failure precisely. Progression failure occurred on the entry bar. Four hours later V16 exited via `RELATIVE_COST_FLOOR` when:
- `relativeReturn24h = +0.004569...` (PENGU had just marginally outperformed BTC over 24h),
- but PENGU was still below EMA72 (`ema72Distance = -0.004226...`).
The baseline event subsequently finished strongly positive.

Therefore the structural hypothesis is: **a brief relative-return cross above zero is not sufficient evidence that a counterwind Short thesis has failed while price structure remains below the existing EMA72 trend reference. A probation exit should require both relative thesis failure and structural reclaim.**

This uses no fitted threshold. The two boundaries already exist in the current engine:
- `relativeReturn24h >= 0`: PENGU no longer weaker than BTC over the existing 24h feature.
- `bar.close >= features.ema72`: PENGU has reclaimed the existing EMA72 structure used by current Short logic.

## Frozen lifecycle
Everything in V16 remains unchanged except the single cost-floor decision condition below.

- Preserve every baseline logical event, direction, original gross, and original baseline exit lifecycle.
- Eligibility remains `btcEma168Distance >= 0 OR btcReturn24h >= 0`.
- Reuse the exact frozen ATR progression state machine:
  - `unit = min(entry ATR24 ratio, hardStopPct / 2)`
  - arm at `+1 unit` MFE
  - progression success at `+2 units`, capped by existing hard stop
  - progression failure if, before success, completed H1 close falls back to `+0.5 unit` or less.
- On progression failure keep the full position and enter probation. No partial close, added gross, re-entry leg, or event count change.
- Thesis resumption remains unchanged and has first priority: completed H1 close below running low-water mark, below EMA72, and BTC 24h return >= 0; if true preserve untouched baseline lifecycle.
- Worst-case cost-cover price remains unchanged from V15/V16.
- **The only V17 change:** cost-floor exit is allowed only when all three are true on the same completed H1 bar:
  1. `bar.close >= costCoverPrice`,
  2. `features.relativeReturn24h >= 0`,
  3. `bar.close >= features.ema72`.
- If cost-cover is reached without both relative reversal and EMA72 structural reclaim, remain in probation.
- Existing 18h absolute probation deadline remains unchanged for V17. V17 is not a deadline experiment.
- All Normal/Severe fee/slippage assumptions remain unchanged.

## Sequential anti-overfit evaluation
Known venues: OKX, Binance, Gate, Bitget. KuCoin Futures remains the untouched final holdout and must stay unopened unless all known-venue gates pass.

Strict PASS for OKX, Binance, Bitget remains the exact V16/V15 contract:
- baseline logical events >=20
- candidate logical events == baseline
- progression-failure modified events >=2
- Normal event win rate >= baseline +5 percentage points
- Normal Return/PF/DD all non-worse
- Severe event win rate >= baseline
- Severe Return/PF/DD all non-worse
- revert single best modified event to baseline: Normal and Severe Return delta >=0
- >=3/4 chronological folds non-worse in event win rate
- >=3/4 folds non-worse in Return.

Gate diagnostic PASS remains:
- same event count
- Normal and Severe event win rate/Return/PF/DD all non-worse.

Only if OKX + Binance + Gate diagnostic + Bitget all pass may KuCoin strategy performance be fetched/calculated. KuCoin data/performance contract remains exactly the one frozen in V16. If development fails, KuCoin stays `RESERVED_UNOPENED`.

No V17 rule change is allowed after any V17 strategy result is observed. Any subsequent idea requires a new preregistered candidate.