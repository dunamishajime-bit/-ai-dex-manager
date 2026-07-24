# V96 Stock Perp Fade Enhancement V11 Result — 2026-07-24

## Decision

**P95_ENHANCEMENT_FOUND_FAILS_SEVERE_SHADOW_ONLY**

The only robustly useful enhancement on the reused historical window was an intraday Basis-convergence exit. The selected candidate is:

`BOTH__FLAT__CONVERGENCE__ABS_TOP1`

No Production, LIVE, VPS, Crypto V96 allocation, or orders were changed.

## Frozen tournament

- Parent signal: absolute Cash/Aster Basis at least 50 bps
- Universe: AMZN, META, MSFT, NVDA, TSLA Aster perpetuals
- Eligible synchronized sessions: 253
- Window: 2025-07-15 through 2026-07-22
- Direction modes: both, premium-Short only, discount-Long only, premium-heavy, discount-heavy
- Sizing modes: flat Gross 1.0, tiered 0.5 / 1.0 / 1.25
- Exit modes: fixed 15:30, Basis convergence, Basis convergence plus 2% price stop
- Selection modes: absolute-Basis Top1, normalized-Basis Top1, normalized-Basis Top2
- Total combinations: 90
- Development selected the top 12 combinations
- Validation selected the final candidate
- Holdout retuning: prohibited
- Gross 1.25 / 1.5 / 2.0 was evaluated only after candidate selection

The convergence rule was predeclared as:

- exit when absolute Basis falls to 15 bps or less;
- also exit when Basis crosses through zero;
- exit when absolute Basis expands to 1.5 times the entry Basis;
- otherwise close at 15:30 New York.

The separate 2% adverse-price stop produced exactly the same trades as the convergence-only candidate and did not add value.

## Selected candidate versus V10 parent

| Metric | V10 PERP_FADE_50 fixed-time | V11 convergence exit |
| --- | ---: | ---: |
| Forward-median full return | +75.2940% | **+84.1529%** |
| Normal full return | +42.0197% | **+49.2096%** |
| P95 full return | +34.7321% | **+41.5560%** |
| Severe full return | -35.6980% | **-32.4211%** |
| Forward-median maximum DD | -8.6036% | **-4.8871%** |
| Normal maximum DD | -12.7076% | **-7.0052%** |
| P95 maximum DD | -14.1669% | **-7.5643%** |
| Normal PF | 1.6831 | **2.0300** |
| P95 PF | 1.5556 | **1.8397** |
| Trades | 132 | 132 |

The improvement came from exit timing rather than more entries.

## Chronological results — selected candidate, Gross 1.0

| Scenario | Development | Validation | Final reused period | Full |
| --- | ---: | ---: | ---: | ---: |
| Forward median | +45.06% approximately | +3.9309% | +12.9183% | +84.1529% |
| Normal | +37.0448% | +1.1460% | +7.6428% | +49.2096% |
| P95 | +32.4788% | +0.4609% | +6.3617% | +41.5560% |
| Severe | -17.6811% | -8.6843% | -10.0987% | -32.4211% |

Validation and the final period remained positive under Normal and P95, but Severe remained negative in every chronological segment.

## Exit diagnostics

Across 132 trades:

- Basis converged: 95 trades approximately;
- Basis expansion stop: 8 trades;
- time exit: 29 trades;
- 2% price stop: 0 additional trades.

This shows that most historical opportunities converged before 15:30 and benefited from an earlier exit.

## Component tests

### Direction

Development Normal / P95:

| Mode | Normal | P95 | Severe |
| --- | ---: | ---: | ---: |
| Both directions | **+27.0589%** | **+22.8218%** | -23.7150% |
| Premium Short only | +5.5401% | +3.2039% | -24.6325% |
| Discount Long only | +12.8556% | +10.0514% | -22.7049% |
| Premium heavy | +20.7641% | +17.8600% | **-16.2454%** |
| Discount heavy | +19.0123% | +15.8938% | -20.1638% |

Both directions produced the strongest Normal/P95 result. Removing one side reduced profit substantially.

### Tiered sizing

Tiered sizing improved Development Normal from +27.06% to +43.13%, but the best tiered combinations failed Validation P95. The leading tiered-convergence candidate produced Validation Normal -0.35% and P95 -0.73%.

Therefore tiered sizing was rejected despite the attractive Development result.

### Exit

Development Normal / P95:

- fixed 15:30 exit: +27.0589% / +22.8218%;
- convergence exit: **+37.0448% / +32.4788%**;
- convergence plus 2% price stop: identical to convergence exit.

The convergence exit was the only standalone improvement that survived Validation.

### Selection

Development Normal / P95:

- absolute Basis Top1: **+27.0589% / +22.8218%**;
- normalized Basis Top1: +9.9330% / +7.1148%;
- normalized Basis Top2: +5.6314% / +2.9219%.

The proposed normalization and Top2 diversification both reduced the edge.

## Concentration tests — selected candidate

| Scenario | Best trade removed | Best month removed |
| --- | ---: | ---: |
| Forward median | +67.2313% | +47.8550% |
| Normal | +35.6960% | +23.8541% |
| P95 | +28.7825% | +18.4840% |
| Severe | -38.2043% | -36.4171% |

Normal and P95 remained positive after removing the best trade or best month.

## Symbol diagnostics

Normal / P95 standalone returns:

- AMZN: +5.8596% / +3.3096%;
- META: +23.2742% / +19.9753%;
- MSFT: +2.8281% / +0.2698%;
- NVDA: +8.4954% / +6.4776%;
- TSLA: +26.0955% / +23.6587%.

Every symbol was positive under Normal and P95, but every symbol was negative under Severe.

Leave-one-out Normal returns remained positive from +32.03% to +49.15%. The result was therefore not dependent on a single symbol, though META and TSLA contributed the most.

## Gross sensitivity — selected candidate

| Multiplier | Normal full | P95 full | Normal DD | P95 DD | Severe full | Severe DD |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1.00 | +49.2096% | +41.5560% | -7.0052% | -7.5643% | -32.4211% | -38.2166% |
| 1.25 | +64.1905% | +53.7377% | -8.6978% | -9.3844% | -38.9997% | -45.3083% |
| 1.50 | +80.3740% | +66.6914% | -10.3674% | -11.1766% | -45.0332% | -51.6161% |
| 2.00 | +116.6255% | +95.0204% | -13.6379% | -14.6787% | -55.5962% | -62.2044% |

Gross 2.0 reaches a crypto-like Normal headline return, but it does so by multiplying a strategy that still has a negative Severe edge. It is therefore not robust and must not be promoted on the historical result.

## Correct conclusion

The recommended research candidate is:

`V96_STOCK_PERP_FADE_50_CONVERGENCE_SHADOW_V1`

Freeze:

- absolute Basis threshold: 50 bps;
- both Long and Short directions;
- absolute-Basis Top1 selection;
- flat Gross 1.0;
- convergence exit at 15 bps or zero-cross;
- Basis expansion stop at 1.5 times entry Basis;
- 15:30 time exit.

Do not add tiered sizing, normalized selection, Top2, or the 2% price stop.

The candidate is stronger than V10 under median, Normal and P95 assumptions and has lower drawdown. It still fails Severe and uses previously inspected, non-independent history. The correct classification remains Shadow-only.

A valid Forward review requires authenticated cash data, actual Aster Spread/depth/Slippage, frozen configuration, at least 60 calendar days and at least 30 events. Historical order-book execution gates could not be reconstructed and were represented only through P95 and Severe cost scenarios.
