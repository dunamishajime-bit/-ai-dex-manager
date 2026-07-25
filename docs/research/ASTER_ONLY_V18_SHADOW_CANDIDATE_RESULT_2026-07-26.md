# Aster-only V18 Shadow Candidate Result

## Status

`ASTER_ONLY_V18_SHADOW_CANDIDATE_FOUND`

The frozen candidate passed every predeclared V18 robustness check. This is a Forward Shadow candidate, not a Production or LIVE approval.

## Candidate

`TIME_SLOT_ZSCORE_FADE__T2__SLOT_1230__H2__NONE`

- venue: AsterDEX only;
- instruments: AMZNUSDT, METAUSDT, MSFTUSDT, NVDAUSDT and TSLAUSDT;
- position count: one Stock-perpetual position total;
- Gross: 1.0;
- Hyperliquid: not used;
- decision time: 12:30 New York;
- maximum holding: two hours;
- no overnight position.

## Entry logic

For every symbol, calculate its Aster-perpetual price relative to the external cash-equity reference at 12:30 New York. Maintain that symbol's prior 20-session distribution of the 12:30 Basis.

A symbol becomes eligible when:

- absolute same-time Basis Z-score is at least 2.0;
- absolute Basis residual is at least 35 bps;
- observable round-trip cost is at most 60 bps;
- the pre-entry residual-reversion edge proxy minus cost is at least 10 bps.

Select the eligible symbol with the largest absolute Z-score.

- positive residual / Aster rich to cash: short Aster;
- negative residual / Aster cheap to cash: long Aster.

Exit on:

- +0.75% take-profit;
- -1.00% stop-loss;
- otherwise two-hour time exit.

## Frozen V13D comparison

V13D benchmark source: workflow `30117325883`, artifact `8605974635`.

| Metric | Aster-only V18 lead | V13D benchmark |
|---|---:|---:|
| Normal compounded return | +15.147608% | +2.979561% |
| P95 compounded return | +13.886964% | +1.855422% |
| Normal trades | 42 | 11 |
| Normal Profit Factor | 2.101689 | 9.173626 in the original artifact |
| Normal maximum drawdown | -3.756571% | -0.360452% in the original artifact |
| Normal net bps per capital-hour | 19.916704 | 2.969653 |
| Separate Hyperliquid collateral | No | Yes |

The Aster-only lead produced approximately 6.71 times the V13D Normal net bps per capital-hour in this historical model. It also had materially higher drawdown and does not hedge broad stock-direction risk.

## Chronological segments

| Segment | Normal | P95 | Normal trades | Normal DD |
|---|---:|---:|---:|---:|
| Development | +9.322165% | +8.367880% | 22 | -3.756571% |
| Validation | +2.120615% | +2.493915% | 3 | -0.442904% |
| Final reused diagnostic | +2.708773% | +2.228068% | 14 | -2.699948% |
| July untouched Holdout | +0.421277% | +0.300986% | 3 | -0.397442% |
| Full through 2026-07-22 | +15.147608% | +13.886964% | 42 | -3.756571% |

July Holdout covered 15 sessions and was not used to change the candidate.

## Robustness

- best individual trade removed: Normal +8.275792%, P95 +7.130676%;
- best calendar month removed (`2025-08`): Normal +9.537866%, P95 +8.466613%;
- excluding AMZN: Normal +15.113806%, P95 +13.894561%;
- excluding META: Normal +11.670906%, P95 +10.668146%;
- excluding MSFT: Normal +15.125742%, P95 +14.310472%;
- excluding NVDA: Normal +9.329671%, P95 +8.347034%;
- excluding TSLA: Normal +8.653006%, P95 +7.762436%;
- Long-only: Normal +9.314308%, PF 2.701684, DD -2.318162%;
- Short-only: Normal +5.336265%, PF 1.685725, DD -2.981979%;
- Severe 100 bps round-trip assumption: no entries through the 60 bps fail-closed gate.

## Interpretation

The candidate is more capital-efficient than V13D because it uses one Aster position rather than separately collateralized Aster and Hyperliquid legs. It can release the Stock allocation after no more than two hours.

Unlike V13D, it is not delta-neutral. A sharp underlying stock move can produce a loss before the two-hour exit or -1% stop. Therefore the historical profit advantage must not be treated as lower risk.

## Required next evidence

Before any Production consideration:

1. implement a no-order Forward Shadow runner using live Pyth primary prices, Alpaca IEX validation and the real Aster order book;
2. collect exact spread, depth, quote age, queue, hypothetical fill and post-entry path evidence;
3. require at least 30 calendar days, 20 completed U.S. sessions and at least five eligible signals;
4. rerun Normal/P95 cost, concentration, direction and capital-conflict checks;
5. verify that V11-EQ and Crypto V96 capital-priority rules prevent the Stock candidate from blocking higher-priority Crypto trades.

No current Production, LIVE, VPS, V96, V11-EQ or V13D code was changed by this research.
