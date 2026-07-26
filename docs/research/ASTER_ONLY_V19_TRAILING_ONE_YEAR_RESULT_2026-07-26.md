# Aster-only V19 Exact Trailing One-Year Result

## Status

`ASTER_ONLY_V19_TRAILING_YEAR_PASS_SHADOW_ONLY`

The frozen Aster-only V18 candidate remained profitable over the exact latest 365-day window. This is a research and Forward-Shadow result, not a Production or LIVE authorization.

## Period

- Start inclusive: 2025-07-25 00:00:00 UTC
- End exclusive: 2026-07-25 00:00:00 UTC
- Calendar span: 365 days
- First aligned session: 2025-07-25
- Last aligned session: 2026-07-24
- Aligned U.S. sessions: 247

Aster aligned history begins on 2025-07-15. Only eight aligned sessions existed before the one-year start, so the frozen 20-session Z-score was not ready during the earliest part of the window. No threshold or lookback change was made to compensate.

## Frozen candidate

`TIME_SLOT_ZSCORE_FADE__T2__SLOT_1230__H2__NONE`

- AsterDEX only;
- AMZNUSDT, METAUSDT, MSFTUSDT, NVDAUSDT and TSLAUSDT;
- 12:30 New York decision;
- prior 20-session same-time Basis Z-score;
- absolute Z-score at least 2.0;
- absolute Basis residual at least 35 bps;
- cost at most 60 bps and estimated Net Edge at least 10 bps;
- one position, Gross 1.0;
- +0.75% take profit, -1.00% stop loss, otherwise two-hour exit;
- no overnight position;
- Hyperliquid not used.

## Main results

| Scenario | Return | PF | Win rate | Trades | Max DD | Net bps / capital-hour |
|---|---:|---:|---:|---:|---:|---:|
| Forward median, 24 bps | +17.861707% | 2.188682 | 43.137255% | 51 | -4.058128% | 18.591530 |
| Normal, 40 bps | +14.687018% | 2.039862 | 41.860465% | 43 | -3.756571% | 18.852259 |
| P95, 44 bps | +13.385861% | 1.926387 | 43.902439% | 41 | -3.988803% | 18.298594 |
| Severe, 100 bps | 0.000000% | — | 0% | 0 | 0.000000% | 0.000000 |

Because the measured window is exactly 365 days, the Normal CAGR is also approximately +14.687018% and the P95 CAGR approximately +13.385861%.

Normal details:

- average trade: +32.881847 bps;
- median trade: -17.727273 bps;
- average holding: 1.744186 hours;
- total capital-hours: 75;
- Long 21 / Short 22;
- take-profit 17 / stop 2 / two-hour exit 24;
- 13 otherwise eligible signals rejected because estimated Net Edge was below 10 bps.

The median trade is negative despite positive aggregate performance. The edge depends on a minority of larger winners, although the removal tests below remain positive.

## Symbol distribution under Normal

- AMZNUSDT: 14
- METAUSDT: 5
- MSFTUSDT: 12
- NVDAUSDT: 5
- TSLAUSDT: 7

## Monthly Normal results

| Month | Return | Trades | Max DD |
|---|---:|---:|---:|
| 2025-08 | +5.121281% | 3 | -0.400000% |
| 2025-09 | +3.404377% | 8 | -1.984064% |
| 2025-10 | +0.690036% | 7 | -1.808387% |
| 2025-11 | +0.505072% | 3 | -0.739690% |
| 2025-12 | -0.618812% | 1 | -0.618812% |
| 2026-01 | 0.000000% | 0 | 0.000000% |
| 2026-02 | 0.000000% | 0 | 0.000000% |
| 2026-03 | +2.574923% | 2 | 0.000000% |
| 2026-04 | -0.195509% | 7 | -2.049449% |
| 2026-05 | -0.374630% | 3 | -1.016897% |
| 2026-06 | +2.839445% | 5 | -0.400000% |
| 2026-07 through July 24 | +0.019592% | 4 | -0.534998% |

2025-08 was the largest profit month. The result is not uniformly positive month by month.

## Robustness

- best individual trade removed: Normal +7.842689%, P95 +6.659301%;
- best month removed, 2025-08: Normal +9.099715%, P95 +7.989360%;
- excluding AMZN: Normal +15.113806%, P95 +13.894561%;
- excluding META: Normal +11.224223%, P95 +10.181206%;
- excluding MSFT: Normal +14.665240%, P95 +13.807506%;
- excluding NVDA: Normal +8.892352%, P95 +7.870307%;
- excluding TSLA: Normal +8.218394%, P95 +7.288281%;
- Long-only: Normal +8.877050%, PF 2.515468, DD -2.318162%;
- Short-only: Normal +5.336265%, PF 1.685725, DD -2.981979%;
- Severe 100 bps assumption: all 56 raw opportunities rejected by the fixed 60 bps cost gate.

Every predeclared V19 pass check succeeded.

## Comparison with the prior V18 full-history audit

| Metric | V18 full through 2026-07-22 | V19 exact latest 365 days |
|---|---:|---:|
| Normal return | +15.147608% | +14.687018% |
| P95 return | +13.886964% | +13.385861% |
| Normal trades | 42 | 43 |
| Normal PF | 2.101689 | 2.039862 |
| Normal DD | -3.756571% | -3.756571% |
| Normal bps / capital-hour | 19.916704 | 18.852259 |

The exact trailing-year result is slightly weaker than the previous broader audit but remains materially positive.

## Evidence

- Workflow run: `30171820854`
- Artifact: `8623126848`
- Artifact SHA-256: `04df78fecb122acb02193f2f45316c82c995a7368c81eecd159c418f3f1b99a9`
- CI: backtest and safety validation passed

## Limitations

- Cash history is Yahoo 60-minute data, not Pyth tick history.
- Aster history is 30-minute candle data and cannot reproduce exact spread, depth, queue position or post-only fills.
- The candidate was selected using overlapping earlier history; this exact-year replay is not an independent Holdout.
- The first 20-session indicator warm-up is constrained by Aster's available aligned history beginning on 2025-07-15.
- Historical performance does not guarantee future profit.

Production, LIVE, VPS, Crypto V96, V11-EQ, current V13D, credentials, orders and positions were not changed.
