# V96 Stock Basis Mature V9 Result — 2026-07-24

## Decision

**NO_VALIDATION_PASSING_BASIS_FAMILY**

Do not promote any tested Basis/Carry strategy to Production or LIVE.

No Production, LIVE, VPS, Crypto V96 allocation, or orders were changed.

## Frozen test

- Strategy ID: `V96_STOCK_BASIS_MATURE_V9`
- Universe: `AMZNUSDT`, `METAUSDT`, `MSFTUSDT`, `NVDAUSDT`, `TSLAUSDT`
- Data: Aster trade-price, Mark-price, Index-price 30-minute bars and actual Funding history
- Signal: completed 10:00 New York 30-minute bar
- Entry: 10:30 New York bar open
- Exit: 15:30 New York bar open
- Eligible aligned sessions: 267
- Window: 2025-07-15 through 2026-07-22
- Development: 2025-07-15 through 2026-02-23
- Validation: 2026-02-24 through 2026-05-07
- Final reused-historical period: 2026-05-08 through 2026-07-22
- Candidate count: 9
- Family count: 3
- Holdout retuning: prohibited

## Data coverage

All five mature symbols had 267 complete aligned sessions.

| Symbol | Trade bars | Mark bars | Index bars | Complete sessions |
| --- | ---: | ---: | ---: | ---: |
| AMZNUSDT | 17,879 | 17,918 | 17,918 | 267 |
| METAUSDT | 17,879 | 17,918 | 17,918 | 267 |
| MSFTUSDT | 17,879 | 17,918 | 17,918 | 267 |
| NVDAUSDT | 17,879 | 17,918 | 17,918 | 267 |
| TSLAUSDT | 17,879 | 18,117 | 18,117 | 267 |

## Family results

| Family | Development-selected candidate | Development Forward-median | Development Normal | Development Severe | Validation Forward-median | Validation Normal | Validation Severe | Pass |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Funding-confirmed basis fade | `FUND_FADE_20.0` | -4.4022% | -10.4838% | -30.1056% | -1.8877% | -2.2044% | -3.3875% | NO |
| Mark-index dispersion pair | `MARK_PAIR_12.0` | -15.0422% | negative | -45.9034% | -1.4939% | -3.6800% | -11.4829% | NO |
| Trade-index dispersion pair | `TRADE_PAIR_20.0` | +3.2036% | -13.1827% | -54.7155% | -4.2295% | -9.6006% | -27.2543% | NO |

## Interpretation

The only positive Development pocket was `TRADE_PAIR_20.0` under the low Forward-median cost approximation. It was already negative under Normal and Severe costs, then became negative in Validation under every cost scenario.

Funding receipts did not rescue the signals. Development Funding contribution was approximately +0.82% for the selected Funding Fade candidate, +0.17% for the selected Mark pair candidate, and +0.04% for the selected Trade pair candidate, while price movement and execution costs were materially larger.

The Aster trade/Mark/Index deviations therefore did not show a persistent intraday convergence edge in this test. Increasing Gross would magnify a negative edge and is not evaluated as a rescue mechanism.

## Evidence limits

- Aster Index is an oracle/reference index, not a directly traded cash-equity hedge.
- Historical order-book and event-risk gates were not reconstructed.
- The last chronological period overlaps previously inspected Stock history and is not an independent Holdout.
- This result tests one predeclared Basis structure; it does not prove every possible underlying-versus-perpetual strategy is unprofitable.

## Next valid boundary

Further threshold searching on the same Aster-only Basis history is not justified. A genuinely new test requires timestamp-aligned underlying U.S. equity data, preferably survivorship-aware 2020-2026 history, paired with Aster trade/Mark/Index/Funding and executable Spread/depth observations.
