# V96 Stock Cross-Venue Perp V12 Result — 2026-07-24

## Decision

**CROSS_VENUE_VALIDATION_LEAD_FAILED_REUSED_HOLDOUT**

Do not promote the tested Aster versus XYZ cross-venue strategy to Production, LIVE or Forward Shadow as a selected alpha engine.

No Production, LIVE, VPS, Crypto V96 allocation, or orders were changed.

## Frozen test

- Strategy ID: `V96_STOCK_CROSS_VENUE_PERP_V12`
- Venues: Aster stock perpetuals versus XYZ HIP-3 stock perpetuals on Hyperliquid
- Universe: AMZN, META, MSFT, NVDA, TSLA
- Data: synchronized 30-minute traded-price candles and actual Funding history from both venues
- Eligible aligned sessions: 73
- Window: 2026-04-13 through 2026-07-22
- Development: 2026-04-13 through 2026-06-10
- Validation: 2026-06-11 through 2026-07-01
- Final reused-historical period: 2026-07-02 through 2026-07-22
- Entry thresholds: 10, 25, 50, 100 bps
- Direction modes: both, Aster premium only, Aster discount only
- Exit modes: fixed time and spread convergence
- Candidate count: 24
- Family count: 6
- Aster / XYZ allocation: 0.5 / 0.5 Gross
- Holdout retuning: prohibited

XYZ candle history was limited by the public API's most-recent-5000-candle retention. All five symbols nevertheless produced 73 fully aligned sessions with zero clock-rejection events.

## Family winners

| Family | Development winner | Dev median | Dev Normal | Dev P95 | Dev Severe | Validation median | Validation Normal | Validation P95 | Validation Severe | P95 pass |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Discount convergence | `ASTER_DISCOUNT_ONLY__CONVERGENCE__T50` | +1.3383% | -0.3593% | -1.1339% | -6.2802% | -0.3521% | -0.9986% | -1.2958% | -3.3079% | NO |
| Discount fixed time | `ASTER_DISCOUNT_ONLY__TIME__T50` | -0.4741% | -2.1436% | -2.9054% | -7.9664% | +1.3254% | +0.6702% | +0.3689% | -1.6704% | YES |
| Premium convergence | `ASTER_PREMIUM_ONLY__CONVERGENCE__T50` | -0.6924% | -2.7388% | -3.6700% | -9.8125% | +1.1000% | +0.3154% | -0.0450% | -2.4791% | NO |
| Premium fixed time | `ASTER_PREMIUM_ONLY__TIME__T50` | -0.0978% | -2.1558% | -3.0921% | -9.2693% | +1.4621% | +0.6752% | +0.3137% | -2.1276% | YES |
| Both convergence | `BOTH__CONVERGENCE__T50` | +0.2688% | -3.1915% | -4.7495% | -14.7676% | +0.7440% | -0.6863% | -1.3403% | -5.7050% | NO |
| Both fixed time | `BOTH__TIME__T50` | -0.8489% | -4.2720% | -5.8133% | -15.7234% | +2.8069% | +1.3499% | +0.6838% | -3.7624% | YES |

No family passed the strict gate requiring Forward-median, Normal, P95 and Severe to all remain positive.

## Selected Validation lead

The Validation selector chose:

`BOTH__TIME__T50`

Rule:

- at 10:30 New York, calculate Aster price divided by XYZ price minus one;
- require an absolute spread of at least 50 bps;
- if Aster is more expensive, Short Aster and Long XYZ;
- if Aster is cheaper, Long Aster and Short XYZ;
- allocate Gross 0.5 to each venue;
- select the largest absolute spread among the five symbols;
- close at approximately 15:30 New York.

### Chronological results

| Scenario | Development | Validation | Final reused period | Full |
| --- | ---: | ---: | ---: | ---: |
| Forward median | -0.8489% | +2.8069% | +0.0546% | +1.9898% |
| Normal | -4.2720% | +1.3499% | -0.7233% | -3.6815% |
| P95 | -5.8133% | +0.6838% | -1.0806% | -6.1939% |
| Severe | -15.7234% | -3.7624% | -3.4935% | -21.7277% |

Full-period metrics for the selected lead:

| Scenario | Trades | Return | PF | Maximum DD |
| --- | ---: | ---: | ---: | ---: |
| Forward median | 44 | +1.9898% | 1.3289 | -3.9174% |
| Normal | 44 | -3.6815% | 0.6043 | -6.1459% |
| P95 | 44 | -6.1939% | 0.4252 | -7.8400% |
| Severe | 44 | -21.7277% | 0.0581 | -21.7277% |

The strategy therefore generated a temporary Validation pocket but did not retain the edge in the final period or full-period Normal/P95 results.

## Interpretation

The gross price legs contained a small pre-cost convergence effect, but two-venue execution costs consumed it. Funding contribution was approximately flat and did not rescue the result.

The convergence-exit variants were weaker than fixed-time in Validation. This indicates that the Aster/XYZ spread did not exhibit the same clean intraday mean reversion previously observed between Aster and the U.S. cash-equity reference in V11.

The result is also based on only 73 synchronized sessions because XYZ's candle endpoint exposes the most recent 5000 candles. This is sufficient to reject the tested implementation, but not sufficient to prove that every cross-venue strategy is unprofitable.

## Correct conclusion

- Do not combine this V12 with V11.
- Do not increase Gross.
- Do not optimize narrower nearby thresholds on the same 73-session sample.
- Keep V11 frozen as the current Stock Shadow candidate.
- The next distinct research family should use a different information source, such as event-conditioned order-flow or Forward-only maker spread capture with actual books and fills.

## Safety

- Research only
- Order submission disabled
- Production unchanged
- LIVE unchanged
- VPS unchanged
- Crypto V96 unchanged
