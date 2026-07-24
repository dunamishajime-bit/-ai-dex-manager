# V96 Stock V13 Historical Proxy Backtest Result — 2026-07-24

## Decision

**V13_HISTORICAL_PROXY_FAILED_NORMAL_ECONOMICS**

The frozen V13 Aster/XYZ Maker-Hedge family did not retain positive historical price-path economics under the primary 1-minute strict fill proxy.

Do not treat V13 as a profitable Stock Shadow candidate. Do not promote it to Production or LIVE.

Production, LIVE, VPS, Crypto V96, V11, real orders and the existing Forward collector were unchanged by this backtest.

## What was tested

- Universe: AMZN, META, MSFT, NVDA, TSLA
- Venues: Aster stock perpetuals and XYZ HIP-3 on Hyperliquid
- Fixed data end: 2026-07-24 00:00 UTC
- Entry dislocation: 12 bps
- Initial virtual Maker notional: 100 USD
- Direction: sell the premium venue and buy the discount venue
- One active cycle per symbol
- Aster-Maker and XYZ-Maker variants evaluated separately
- No threshold, symbol, direction or cost optimization

The primary result uses:

- 1-minute synchronized candles;
- `OPEN_CROSS_STRICT`, where the next bar open must already be at or through the previous completed-bar Maker quote;
- one-minute inventory holding;
- V13 forced-Taker close cost envelopes of 10 / 16 / 26 / 45 bps.

## Data coverage

### 1-minute primary proxy

- Regular sessions: 4
- Last aligned timestamp: 2026-07-23 23:59 UTC
- First aligned timestamp varied by symbol from 2026-07-20 19:03 UTC to 19:32 UTC
- Aster bars per symbol: 5,000
- XYZ aligned bars per symbol: 4,588 to 4,617

### 15-minute structural diagnostic

- Regular sessions: 38
- Aligned period: approximately 2026-06-02 through 2026-07-23
- Aster bars per symbol: 5,000
- XYZ aligned bars per symbol: 4,972 to 4,974

Hyperliquid exposes only the most recent 5,000 candles per interval. The 1-minute test is therefore necessarily short, while the 15-minute test is not execution parity with V13's 60-second inventory rule.

## Primary 1-minute strict result

Forced-Taker cost envelope:

| Maker venue | Cycles | Sessions | Gross average | Forward median net | Normal net | P95 net | Severe net | Normal positive rate | Normal PF |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Aster | 21 | 4 | -2.3777 bps | -12.3777 bps | -18.3777 bps | -28.3777 bps | -47.3777 bps | 0.00% | 0.0000 |
| XYZ | 1,062 | 4 | -0.4284 bps | -10.4284 bps | -16.4284 bps | -26.4284 bps | -45.4284 bps | 4.80% | 0.0303 |

The result failed before relying on execution costs: average gross cycle PnL was already negative for both Maker-venue variants.

The Aster-Maker strict sample was concentrated in TSLA, with 18 of 21 cycles. This weakens standalone Aster-Maker inference, but the much larger XYZ-Maker sample also failed across all five symbols.

## Optimistic intrabar-touch upper bound

Even when any next-bar high/low touch was accepted as a virtual Maker fill:

| Maker venue | Cycles | Gross average | Forced Normal net | Forced P95 net | Forced Severe net | Normal positive rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Aster | 35 | +2.0908 bps | -13.9092 bps | -23.9092 bps | -42.9092 bps | 8.57% |
| XYZ | 1,259 | -0.1381 bps | -16.1381 bps | -26.1381 bps | -45.1381 bps | 4.45% |

This optimistic fill upper bound also failed Normal, P95 and Severe economics.

## Lower-cost two-Maker sensitivity

Using the lower 6 / 10 / 17 / 30 bps two-Maker envelope did not rescue the strict 1-minute rule:

| Maker venue | Normal net | P95 net | Severe net |
| --- | ---: | ---: | ---: |
| Aster | -12.3777 bps | -19.3777 bps | -32.3777 bps |
| XYZ | -10.4284 bps | -17.4284 bps | -30.4284 bps |

Therefore the rejection is not dependent on assuming every cycle requires the higher forced-close profile.

## 15-minute structural result

The 15-minute result is a longer-history structural diagnostic only.

### Strict Aster-Maker

- Cycles: 149
- Sessions: 36
- Gross average: +8.6096 bps
- Forced Normal average: -7.3904 bps
- Forced P95 average: -17.3904 bps
- Forced Severe average: -36.3904 bps
- Normal positive rate: 32.21%

Chronological Forced Normal averages:

- Development, 2026-06-02 to 2026-07-01: -5.4719 bps
- Validation, 2026-07-02 to 2026-07-13: -5.2179 bps
- Holdout, 2026-07-14 to 2026-07-23: -13.8568 bps

### Strict XYZ-Maker

- Cycles: 927
- Sessions: 38
- Gross average: +2.9907 bps
- Forced Normal average: -13.0093 bps
- Forced P95 average: -23.0093 bps
- Forced Severe average: -42.0093 bps
- Normal positive rate: 28.05%

Chronological Forced Normal averages:

- Development: -13.7229 bps
- Validation: -13.1661 bps
- Holdout: -10.9389 bps

No chronological segment passed Normal economics.

The only superficially positive sensitivity was the optimistic 15-minute Aster touch model under the lower two-Maker Normal envelope, at +1.1690 bps average. The same rows were -4.8310 bps under Forced Normal, -14.8310 bps under P95 and -33.8310 bps under Severe, so this is not a robust lead.

## Interpretation

The tested spread did not converge quickly enough to support V13's one-minute inventory objective. In the primary 1-minute test, the gross price path was negative before fees for both Maker venues.

Extending the horizon to 15 minutes produced a small gross Aster-Maker convergence effect, but it remained below realistic complete-cycle costs and weakened further in the final period.

This agrees with the earlier V12/V12B conclusion that static Aster/XYZ basis convergence is consumed by two-venue execution costs. Adding a Maker opening assumption did not create enough historical edge.

## Important execution boundary

Historical candle data cannot reconstruct:

- displayed queue ahead;
- queue cancellations;
- aggressive trade direction;
- full versus partial Maker fill;
- exact best bid/ask;
- the frozen 250 ms hedge path.

Accordingly, this result can reject weak price-path economics, but it cannot prove real Maker execution quality. The current result is already negative enough that missing queue realism would be expected to make it worse, not better.

## Correct conclusion

- Reject the frozen V13 historical price-path economics.
- Do not increase Gross.
- Do not optimize nearby thresholds on the same data.
- Do not combine V13 with V11.
- Keep V11 as the current Stock Shadow candidate.
- The ongoing V13 Forward collector may be retained only as market-microstructure research evidence, not as validation of a profitable strategy.
- A future cross-venue candidate must add a genuinely different information source, such as predeclared event-conditioned order-flow leadership, rather than another static spread threshold.

## Safety

- Research only
- Order submission disabled
- Production unchanged
- LIVE unchanged
- VPS unchanged
- Crypto V96 unchanged
- V11 unchanged
- V13 Forward collector unchanged
