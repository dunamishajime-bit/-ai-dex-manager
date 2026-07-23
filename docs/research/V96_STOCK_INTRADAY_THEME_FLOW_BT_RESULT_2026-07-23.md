# V96 Stock Intraday Theme Flow V1 — Backtest Result

## Decision

**NO_ROBUST_INTRADAY_THEME_FLOW_EDGE**

Do not merge this candidate into Production and do not enable LIVE orders.

The frozen thresholds were evaluated without retuning after the result was seen.

## Evaluation scope

- Strategy: `V96_STOCK_INTRADAY_THEME_FLOW_V1`
- Data request window: 2025-01-01 through 2026-07-22 completed data
- First evaluable date after the required prior-20-session history: 2025-08-12
- Last evaluable date: 2026-07-22
- Fixed universe: 22 Aster stock perpetuals
- Signal bars: completed U.S. regular-session 15-minute bars
- Entry: next 15-minute bar open
- No overnight holding
- One Stock position at a time
- Maximum Stock Gross: 1.0
- Initial / add caps: 0.50 / 0.50
- Historical OI, exact event chronology, halts and book-quality gates were not reconstructed
- Forward Spread and Slippage observations were represented through cost scenarios

## Full result

| Scenario | Trades | Return | CAGR | PF | Win rate | Max DD | Best trade removed | Best month removed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Forward median | 126 | -6.7859% | -6.6624% | 0.5503 | 38.8889% | -7.1877% | -7.4257% | -7.6769% |
| Normal | 126 | -10.9792% | -10.7838% | 0.3846 | 33.3333% | -11.2817% | -11.5672% | -11.6391% |
| Forward p95 | 126 | -12.0924% | -11.8786% | 0.3513 | 30.9524% | -12.3711% | -12.6674% | -12.6967% |
| Severe | 126 | -25.2343% | -24.8233% | 0.1260 | 18.2540% | -25.2525% | -25.6557% | -25.1832% |

Forward-median average winner was +0.1744%, while the average loser was -0.2016%. The edge is negative before applying the missing Forward-only entry blocks.

## Chronological split

### Forward-median cost

| Split | Dates | Trades | Return | PF | Win rate |
| --- | --- | ---: | ---: | ---: | ---: |
| Development | 2025-08-12–2026-03-05 | 61 | -6.5709% | 0.3302 | 34.4262% |
| Validation | 2026-03-06–2026-05-13 | 31 | +1.1390% | 1.5528 | 45.1613% |
| Holdout | 2026-05-14–2026-07-22 | 34 | -1.3537% | 0.5965 | 41.1765% |

### Severe cost

| Split | Dates | Trades | Return | PF | Win rate |
| --- | --- | ---: | ---: | ---: | ---: |
| Development | 2025-08-12–2026-03-05 | 61 | -19.6389% | 0.0362 | 11.4754% |
| Validation | 2026-03-06–2026-05-13 | 31 | -2.4426% | 0.4557 | 29.0323% |
| Holdout | 2026-05-14–2026-07-22 | 34 | -4.6333% | 0.2151 | 20.5882% |

The isolated positive Validation interval does not reproduce in the untouched Holdout and fails under Severe costs.

## Direction and concentration

Forward-median result:

- Long: 63 trades, approximately -2.42%, PF 0.635
- Short: 63 trades, approximately -4.48%, PF 0.487
- AI theme: 77 trades, -5.9522%
- Semiconductor theme: 49 trades, -0.8864%
- TSLA was the only material positive symbol contributor at +1.4366%
- MSFT and META were the largest negative symbol contributors

This is not a one-sided Short implementation problem. Both directions lose.

## Exit behavior

Across 126 trades:

- forced intraday exit: 101
- VWAP failure: 13
- opposite signal: 9
- hard stop: 3

Most signals did not produce enough same-session continuation to overcome turnover costs before the mandatory close.

## Interpretation

The collected execution evidence correctly showed that Spread, depth and book consistency must gate orders. However, those gates cannot create a profitable directional edge when the underlying OHLCV signal is already negative.

Adding the missing historical OI/event/book gates would reduce trade count. It should not be represented as evidence that this negative core would become profitable.

Do not optimize the same family by searching nearby breadth, ATR-break, relative-volume, VWAP or session-time thresholds on this inspected history. Any materially different design must receive a new Strategy ID and a new predeclared test.

## Safety

- Production changed: no
- LIVE changed: no
- VPS changed: no
- Crypto V96 changed: no
- Orders submitted: no
