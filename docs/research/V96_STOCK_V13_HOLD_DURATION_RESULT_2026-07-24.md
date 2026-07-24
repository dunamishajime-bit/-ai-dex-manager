# V96 Stock V13 Longer-Hold Historical Result — 2026-07-24

## Decision

**V13_LONGER_HOLD_NO_DEVELOPMENT_EDGE** under the predeclared robust gate.

However, the user's hypothesis was directionally correct: extending the Aster-Maker hold from minutes to approximately five hours materially improved the historical price-path economics. The 300-minute candidate became positive under Normal and slightly positive under full-period P95, but it did not retain positive P95 in Development and Validation and remained negative under Severe costs.

Do not promote this result to Production or LIVE. It is a historical candidate-selection result on reused V12/V12B history.

## Fixed test

- 74 regular sessions from 2026-04-13 through 2026-07-23;
- synchronized 30-minute Aster and XYZ candles;
- actual public Funding histories from both venues;
- AMZN, META, MSFT, NVDA, TSLA;
- fixed 12 bps entry dislocation;
- strict next-bar-open Maker fill proxy;
- Aster-Maker and XYZ-Maker tested separately;
- fixed holds of 30, 60, 120, 180, 240 and 300 minutes;
- 100 USD initial virtual Maker notional;
- no overnight inventory;
- no threshold, symbol or direction retuning.

Chronological split:

- Development: 2026-04-13 through 2026-06-11;
- Validation: 2026-06-12 through 2026-07-02;
- Holdout: 2026-07-03 through 2026-07-23.

## Forced-Taker Normal results

| Candidate | Cycles | Gross average | Development | Validation | Holdout | Full | Full win rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Aster Maker 30m | 178 | +7.2926 bps | -6.3391 | -8.6909 | -16.7202 | -8.7074 | 36.52% |
| Aster Maker 60m | 150 | +11.3003 bps | -3.8864 | -4.2783 | -7.6606 | -4.6997 | 42.67% |
| Aster Maker 120m | 122 | +13.8914 bps | -4.1091 | +1.3925 | -0.3678 | -2.1086 | 40.98% |
| Aster Maker 180m | 97 | +14.2993 bps | -2.8430 | +1.5477 | -2.5578 | -1.7007 | 41.24% |
| Aster Maker 240m | 75 | +22.2539 bps | -1.8471 | +21.4789 | +8.4268 | +6.2539 | 52.00% |
| **Aster Maker 300m** | **49** | **+26.7237 bps** | **+9.0245** | **+5.1068** | **+20.2071** | **+10.7237** | **55.10%** |
| XYZ Maker 30m | 846 | +4.0359 bps | -12.5344 | -11.8811 | -10.2953 | -11.9641 | 31.32% |
| XYZ Maker 60m | 662 | +7.3653 bps | -8.9814 | -4.6663 | -11.6762 | -8.6347 | 36.25% |
| XYZ Maker 120m | 446 | +8.1093 bps | -8.9433 | -12.0782 | -0.3929 | -7.8907 | 38.12% |
| XYZ Maker 180m | 331 | +8.5079 bps | -10.4398 | -2.4479 | -3.4521 | -7.4921 | 38.97% |
| XYZ Maker 240m | 288 | +12.4700 bps | -5.7741 | -4.6706 | +4.9478 | -3.5300 | 42.71% |
| XYZ Maker 300m | 203 | +9.3294 bps | -6.4503 | -9.3393 | -4.1301 | -6.6706 | 36.95% |

## Aster Maker 300-minute detail

Primary forced-Taker complete-cycle envelope:

| Scenario | Development | Validation | Holdout | Full | Full PF | Full positive rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Normal, 16 bps | +9.0245 | +5.1068 | +20.2071 | **+10.7237** | 2.0991 | 55.10% |
| P95, 26 bps | -0.9755 | -4.8932 | +10.2071 | **+0.7237** | 1.0487 | 42.86% |
| Severe, 45 bps | -19.9755 | -23.8932 | -8.7929 | **-18.2763** | 0.3368 | 28.57% |

Funding averaged only +0.0597 bps per cycle. The improvement came from slower price convergence, not Funding.

### Lower-cost two-Maker sensitivity

| Scenario | Development | Validation | Holdout | Full |
| --- | ---: | ---: | ---: | ---: |
| Normal, 10 bps | +15.0245 | +11.1068 | +26.2071 | **+16.7237** |
| P95, 17 bps | +8.0245 | +4.1068 | +19.2071 | **+9.7237** |
| Severe, 30 bps | -4.9755 | -8.8932 | +6.2071 | **-3.2763** |

This is meaningful because the V13 design intends to seek a Maker close when possible. But historical candles cannot establish that the second Maker fill is achievable, and Severe still failed in Development and Validation.

## Symbol contribution for Aster Maker 300m under Forced Normal

| Symbol | Cycles | Average net | Total net |
| --- | ---: | ---: | ---: |
| AMZN | 3 | +79.954 bps | +239.861 bps |
| META | 10 | +25.398 bps | +253.981 bps |
| MSFT | 5 | +15.785 bps | +78.926 bps |
| NVDA | 16 | +3.483 bps | +55.724 bps |
| TSLA | 15 | -6.869 bps | -103.032 bps |

META contributed approximately 40.41% of total positive symbol profit, slightly above the frozen 40% concentration limit. AMZN had only three cycles and a very large average result. The candidate is therefore not yet broad enough to call robust.

## Interpretation

The 60-second and 15-minute versions were indeed too short to capture most of the Aster-versus-XYZ convergence. The historical convergence effect became economically relevant only around four to five hours.

The stronger result is specifically:

- Maker opening on Aster;
- opposite Taker hedge on XYZ;
- approximately 300-minute intraday hold;
- no overnight inventory.

It is not a general XYZ-Maker result. Every XYZ-Maker duration remained negative under full-period Forced Normal.

The correct classification is a **Normal-cost historical lead that fails strict P95/Severe robustness**, not a fully rejected idea and not a Production candidate.

## Next rule to freeze before Forward

Do not search 330, 360 or nearby durations on the same history. The clean next candidate is the already tested 300-minute Aster-Maker rule. It can be frozen as a separate Forward/Shadow arm before the untouched window begins, while the original 60-second arm remains available only as a control.

Promotion still requires actual queue consumption, partial-fill safety, 250 ms hedge behavior, second-Maker close feasibility, P95/Severe results and concentration below 40% in untouched Forward evidence.

## Safety

- Research only
- Order submission disabled
- Production unchanged
- LIVE unchanged
- VPS unchanged
- Crypto V96 unchanged
- V11 unchanged
- V13 Forward collector unchanged
