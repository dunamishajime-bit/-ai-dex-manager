# V96 Stock Cash / Aster Perp Basis V10 Result — 2026-07-24

## Decision

**P95_SINGLE_HISTORICAL_LEAD_FAILS_SEVERE_SHADOW_ONLY**

A historically promising Aster-only candidate was found, but it is not Production-eligible:

`PERP_FADE_50.0`

The candidate must remain Shadow-only because:

- no candidate passed the predeclared strict Validation gate requiring Forward-median, Normal and Severe to all be positive;
- only the 50 bps threshold retained the P95 historical lead, while the neighboring 25 bps and 10 bps thresholds failed;
- Severe remained materially negative;
- the history and thresholds have already been inspected;
- cash data used an unofficial public chart response rather than an authenticated institutional feed.

No Production, LIVE, VPS, Crypto V96 allocation, or orders were changed.

## Frozen test

- Strategy ID: `V96_STOCK_CASH_PERP_BASIS_V10`
- Diagnostic IDs: `V10B_FIXED_DIAGNOSTIC`, `V10C_PREDECLARED_GRID`
- Universe: AMZN, META, MSFT, NVDA and TSLA versus their Aster USDT perpetuals
- Cash data: public 60-minute U.S. regular-session chart responses
- Perp data: Aster 30-minute trade bars and actual Funding history
- Cash signal: completed 09:30–10:30 New York hourly bar
- Perp signal: completed 10:00–10:30 New York 30-minute bar
- Entry: synchronized 10:30 New York opens
- Exit: approximately 15:30 New York
- Clock tolerance: maximum five minutes
- Eligible fully aligned sessions: 253
- Window: 2025-07-15 through 2026-07-22
- Development: 2025-07-15 through 2026-02-23
- Validation: 2026-02-24 through 2026-05-07
- Final reused-historical period: 2026-05-08 through 2026-07-22
- Candidate count: 12
- Family count: 4
- Thresholds: 10 / 25 / 50 bps, predeclared before the result
- Holdout retuning: prohibited

All five symbols had 253 synchronized sessions and zero clock-rejection events.

## Strict family selection

No family passed the strict Validation requirement.

| Family | Development winner | Dev Forward median | Dev Normal | Dev Severe | Validation Forward median | Validation Normal | Validation Severe | Pass |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Cash-hedged convergence | `CASH_HEDGE_50.0` | +22.5580% | +11.6370% | -23.8757% | -0.5930% | -2.4363% | -9.6474% | NO |
| Cross-sectional Perp pair | `XS_PERP_PAIR_50.0` | +6.5630% | -7.8781% | -46.7532% | -0.3718% | -4.1287% | -17.0437% | NO |
| Funding-confirmed cash hedge | `FUND_HEDGE_50.0` | +1.0628% | -1.0275% | -9.1599% | 0 trades | 0 trades | 0 trades | NO |
| Perp-only basis fade | `PERP_FADE_50.0` | +45.5008% | +27.0589% | -23.7150% | +3.6135% | +0.8366% | -8.9654% | NO |

The theoretical cash hedge did not improve the result. In the selected cash-hedged candidate, the cash leg contributed negatively overall and Validation was negative under every scenario.

## Historical lead: PERP_FADE_50.0

Rule:

- at 10:30 New York, calculate `Aster Perp / U.S. cash equity - 1`;
- require absolute Basis of at least 50 bps;
- if Perp is above cash, Short the Aster Perp;
- if Perp is below cash, Long the Aster Perp;
- use Aster only, Gross 1.0;
- close around 15:30 New York;
- include actual Funding occurring during the holding interval.

### Full-period results

| Scenario | Return | CAGR | PF | Win rate | Maximum DD |
| --- | ---: | ---: | ---: | ---: | ---: |
| Forward median, 12 bps one-way | +75.2940% | +74.0355% | 2.3517 | 49.24% | -8.6036% |
| Normal, 20 bps one-way | +42.0197% | +41.3816% | 1.6831 | 45.45% | -12.7076% |
| Forward P95, 22 bps one-way | +34.7321% | approximately +34% | 1.5556 | positive expectancy | -14.1669% |
| Severe, 50 bps one-way | -35.6980% | negative | 0.5917 | 31.06% | -41.6189% |

Trade count: 132.

Funding contribution was approximately -0.10% in aggregate, so the historical result came from price convergence rather than Funding income.

### Chronological results

| Scenario | Development | Validation | Final reused period |
| --- | ---: | ---: | ---: |
| Forward median | +45.5008% | +3.6135% | +16.2748% |
| Normal | +27.0589% | +0.8366% | +10.8474% |
| Forward P95 | +22.8218% | +0.1534% | +9.5293% |
| Severe | -23.7150% | -8.9654% | -7.4069% |

### Concentration removal

| Scenario | Best trade removed | Best month removed |
| --- | ---: | ---: |
| Forward median | +59.1865% | +37.3899% |
| Normal | +29.1573% | +15.0736% |
| Forward P95 | positive | +10.0809% |
| Severe | negative | -40.9521% |

The Normal and P95 results were not dependent on only one trade or one month.

## Predeclared threshold neighborhood

| Candidate | Normal full | P95 full | Normal Validation | P95 Validation | Normal final | P95 final | Normal best-month removed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `PERP_FADE_10.0` | -9.4144% | -17.0840% | -10.9963% | -12.5185% | -2.5557% | -4.5250% | -26.6016% |
| `PERP_FADE_25.0` | +19.5198% | +11.3559% | -0.9529% | -2.1742% | +2.6678% | +0.7966% | -3.1572% |
| `PERP_FADE_50.0` | +42.0197% | +34.7321% | +0.8366% | +0.1534% | +10.8474% | +9.5293% | +15.0736% |

Only `PERP_FADE_50.0` met the relaxed historical P95 lead definition. Therefore this is a single-threshold lead, not a locally stable region.

## Basis distribution

Across 1,265 symbol-session observations:

- signed median Basis: +4.35 bps;
- absolute median: 15.39 bps;
- absolute 75th percentile: 44.81 bps;
- absolute 90th percentile: 134.73 bps;
- absolute 95th percentile: 214.90 bps;
- observed maximum: 951.17 bps.

A 50 bps threshold is close to the upper quartile boundary, which explains why it reduces low-quality high-turnover signals while still producing 132 historical trades.

## Classification

The correct classification is:

`P95_SINGLE_HISTORICAL_LEAD_FAILS_SEVERE_SHADOW_ONLY`

It is materially stronger than all prior tested Stock families under observed median, Normal and P95 cost assumptions. It is still much weaker than Crypto V96 and does not pass Severe.

Do not promote directly to real-money trading. The next valid test is a frozen Forward Shadow comparison using authenticated cash-equity data and actual Aster Spread/depth, with no threshold changes after the Forward clock starts.

Suggested Forward gates:

- minimum 60 calendar days;
- minimum 30 candidate events;
- authenticated and timestamped cash reference feed;
- Aster actual Spread, depth-fill Slippage, fees and Funding;
- Normal and observed-P95 net return positive;
- Normal and observed-P95 PF above 1.20;
- no material daily-loss or drawdown deterioration;
- report Severe as a stress warning, not as hidden evidence;
- configuration fingerprint frozen before collection.

## Limitations

- public cash chart data is unofficial and unauthenticated;
- intraday cash bars were not back-adjusted for corporate actions, though detected event types were recorded;
- USDT was treated as approximately equal to USD;
- the final period had already been inspected by earlier Stock research and is not an independent Holdout;
- historical order-book, exact event-risk gates, exchange outages and fill rejection were not reconstructed;
- the strategy trades only Aster Perps, but its signal depends on an external U.S. cash-equity feed.
