# V96 Stock V13 Edge-Floor and Diversification Result — 2026-07-24

## Decision

**V13G_EDGE20_PROFIT_LEAD_CONCENTRATED_FORWARD_ONLY**

The user's direction to continue pursuing profit produced a materially stronger historical lead.

The strongest no-lookahead Growth arm raised the minimum Aster/XYZ entry dislocation to 20 bps while preserving the already-selected 10:00 New York entry and late take-profit structure. It remained positive under Forced Normal, P95 and Severe costs in Development, Validation, the final chronological segment and the full period.

It is not Production- or LIVE-ready because the history was reused and META contributed approximately 46.96% of positive Normal profit.

Production, LIVE, VPS, Crypto V96, V11, real orders and the original V13 Forward collector were unchanged.

## Frozen evidence and chronology

- Universe: AMZN, META, MSFT, NVDA, TSLA
- Venues: Aster Maker and opposite XYZ Taker hedge
- Data: synchronized 30-minute candles plus actual public Funding histories
- Regular sessions: 74
- Full window: 2026-04-13 through 2026-07-23
- Development: 2026-04-13 through 2026-06-11
- Validation: 2026-06-12 through 2026-07-02
- Final chronological segment: 2026-07-03 through 2026-07-23
- Entry time: exactly 10:00 New York
- Entry direction: Aster discount BUY or Aster premium SELL
- Portfolio: one position total
- Selection: largest absolute spread among symbols available at the same 10:00 timestamp only
- Exit: 15:00 target; completed 14:00 pair price PnL of at least 30 bps exits at 14:30
- Initial virtual notional: 100 USD
- No overnight inventory
- No same-day future-opportunity lookahead

## Growth arm

Selected on Development:

**`EDGE20__NONE`**

- minimum absolute Aster/XYZ dislocation: 20 bps;
- no symbol cooldown;
- same simultaneous-only portfolio selection;
- no nearby 18 / 22 / 25 bps search permitted after this result.

### Forced-Taker complete-cycle results

| Period | Cycles | Normal | P95 | Severe |
| --- | ---: | ---: | ---: | ---: |
| Development | 5 | +30.9962 bps | +20.9962 bps | +1.9962 bps |
| Validation | 6 | +34.6580 bps | +24.6580 bps | +5.6580 bps |
| Final chronological segment | 5 | +53.0543 bps | +43.0543 bps | +24.0543 bps |
| **Full** | **16** | **+39.2625 bps** | **+29.2625 bps** | **+10.2625 bps** |

Full-period quality:

| Scenario | Positive rate | Profit factor | Total net |
| --- | ---: | ---: | ---: |
| Normal | 81.25% | 18.4139 | +628.2004 bps |
| P95 | 81.25% | 8.0859 | +468.2004 bps |
| Severe | 68.75% | 2.2239 | +164.2004 bps |

At one-times virtual Stock Gross, the chronological Normal portfolio proxy compounded to **+6.4595%** with **-0.3605%** maximum drawdown over the 74-session evidence window.

This is approximately 3.66 times the prior Aster-Maker 300-minute candidate's +10.7237 bps Forced Normal average.

### Two-Maker sensitivity

If a second Maker close can actually be obtained:

| Scenario | Full average | PF |
| --- | ---: | ---: |
| Normal | +45.2625 bps | 33.4490 |
| P95 | +38.2625 bps | 16.6675 |
| Severe | +25.2625 bps | 6.1771 |

These results are sensitivity only. Historical candles cannot prove the second Maker fill.

### Concentration

| Symbol | Cycles | Normal total net |
| --- | ---: | ---: |
| AMZN | 2 | +165.3592 bps |
| META | 8 | +295.0045 bps |
| MSFT | 1 | +31.7679 bps |
| NVDA | 3 | +76.0923 bps |
| TSLA | 2 | +59.9765 bps |

META contributed approximately **46.96%** of positive Normal profit, above the frozen 40% concentration limit.

The result was not dependent on one trade or one month:

- best trade removed: Normal average +33.2634 bps, PF 14.8311;
- best month removed: Normal average +32.9936 bps, PF 11.0605.

## Diversified arm

Selected on Development:

**`EDGE20__NO_PREVIOUS_SYMBOL`**

The immediately preceding completed trade's symbol is skipped for the next trade.

### Forced-Taker complete-cycle results

| Period | Cycles | Normal | P95 | Severe |
| --- | ---: | ---: | ---: | ---: |
| Development | 5 | +30.9962 bps | +20.9962 bps | +1.9962 bps |
| Validation | 6 | +23.3133 bps | +13.3133 bps | -5.6867 bps |
| Final chronological segment | 4 | +48.6955 bps | +38.6955 bps | +19.6955 bps |
| **Full** | **15** | **+32.6428 bps** | **+22.6428 bps** | **+3.6428 bps** |

Full-period Normal PF was 14.5730, the positive rate was 80.00%, and the Normal portfolio proxy compounded to +4.9990% with -0.3605% maximum drawdown.

Positive-profit concentration fell to **33.77%**, passing the 40% limit. However, Validation Severe was negative, so this arm is not as stress-stable as the Growth arm.

## Interpretation

The historical improvement came from three structural corrections rather than leverage:

1. the original 60-second hold was extended to an intraday convergence horizon;
2. weak 10:30 entries were removed and entry was fixed at 10:00;
3. only Aster/XYZ dislocations of at least 20 bps were accepted.

The Growth arm produced the strongest profit and passed all three Forced cost scenarios across every chronological period, but remained concentrated in META. The Diversified arm corrected concentration while sacrificing some Validation Severe quality.

The correct next comparison is therefore not another historical threshold search. It is an untouched Forward/Shadow comparison of two already-frozen arms:

- **V13G Growth:** 10:00, edge at least 20 bps, no cooldown;
- **V13D Diversified:** 10:00, edge at least 20 bps, previous symbol skipped once.

The existing 60-second V13 arm should remain only as the original control.

## Important execution boundary

Historical candles cannot reconstruct:

- displayed queue ahead;
- queue cancellations;
- aggressive trade direction;
- partial versus complete Maker fills;
- exact executable bid/ask;
- the frozen 250 ms hedge path;
- second-Maker close feasibility.

The 74-session history was previously inspected, so these results are strong candidate-selection evidence rather than an independent Holdout.

## Safety

- Research only
- Order submission disabled
- Production unchanged
- LIVE unchanged
- VPS unchanged
- Crypto V96 unchanged
- V11 unchanged
- Original V13 Forward collector unchanged
