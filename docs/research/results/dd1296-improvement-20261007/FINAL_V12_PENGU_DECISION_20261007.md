# DD12.96 V12 / PENGU Improvement Decision — 2026-10-07

Status: **RESEARCH COMPLETE / NO PRODUCTION LOGIC CHANGE RECOMMENDED YET**

## Reproducible formal anchor

The final DD12.96 10 bps scenario was replayed exactly before testing variants.

- Final equity: JPY 4,067,358,397.424793
- Profit factor: 2.960180377096512
- Maximum MTM drawdown: -12.96457052048714%
- Closed trades: 1,358
- V12: 995 trades / 643 wins / 352 losses
- Accounting: PASS
- Ownership conflicts: 0

Exact formal Q102 parity is **HIGH_VOL SHORT 0.60x**. The previously discussed 0.70x is not the final DD12.96 target.

## V12 BTC 12h / 24h veto

Decision: **REJECT**

The lightest tested directional veto reduced V12 losses but did not improve portfolio drawdown and materially reduced final equity.

| Variant | Final equity | PF | Max DD | V12 W/L |
| --- | ---: | ---: | ---: | ---: |
| Formal baseline | JPY 4.067bn | 2.9602 | -12.9646% | 643 / 352 |
| 12h+24h opposite >=1% veto | JPY 3.719bn | 2.9866 | -12.9646% | 624 / 336 |
| 12h+24h opposite >=0.5% veto | JPY 3.036bn | 2.9726 | -12.9646% | — |
| 12h+24h opposite >0 veto | JPY 2.981bn | 2.9685 | -12.9646% | — |

Keep the current V12 causal gates (same-side six-loss cooldown, AVAX/ATOM gates) unchanged.

## PENGU SHORT — completed-H1 72h trend research

The current standalone formal Short baseline is 25 trades, 60% WR, PF 2.904, max DD -14.59%, +150.8%.

### Exact M05 candidate

Candidate:
- only allow a PENGU SHORT candidate when the **last completed signal-H1 PENGU 72h return <= -0.50%**
- causal / completed H1 only
- no change to Gross, exits, Q60, DD17/H72, route quarantine, Long logic, or other strategies

Formal candidate-root parity was proven:
- original root: 2,484 candidates
- M05 root: 2,483 candidates
- all 2,483 shared candidate objects are semantically identical
- exactly one PENGU SHORT candidate is removed

Removed candidate:
- signal: 2026-07-17 19:00Z
- completed-H1 72h return: -0.407539%
- route: SHORT_V20
- outcome in baseline: SHORT_HARD_STOP

Exact integrated 10 bps result:

| | Baseline | M05 |
| --- | ---: | ---: |
| Final equity | JPY 4,067,358,397 | **JPY 4,462,295,320** |
| PF | 2.96018 | **3.37503** |
| Max DD | -12.9646% | **-12.9646%** |
| PENGU trades | 66 | 65 |
| PENGU PnL | JPY 181,883,587 | **JPY 464,661,113** |
| Accounting | PASS | PASS |
| Ownership conflicts | 0 | 0 |

### Cost stress

M05 beat the exact baseline at every tested cost with the same corresponding max DD.

| Round-trip cost | Baseline final equity | M05 final equity |
| --- | ---: | ---: |
| 8 bps | JPY 5.251bn | **JPY 5.764bn** |
| 10 bps | JPY 4.067bn | **JPY 4.462bn** |
| 20 bps | JPY 1.007bn | **JPY 1.101bn** |
| 30 bps | JPY 0.300bn | **JPY 0.326bn** |

### Threshold-neighborhood test

The next more negative formal SHORT signal after -0.4075% is -0.9742%, and that trade is a winner.

Therefore thresholds from roughly -0.425% through -0.97% produce the same one-candidate removal as M05. The improvement is not a numerical knife-edge at exactly -0.50%, but making the filter materially stricter removes good trades and hurts the portfolio.

- <= -1.0%: JPY 3.868bn
- <= -1.25%: JPY 3.868bn
- <= -1.7% / -4.0%: JPY 3.431bn
- <= -5.0%: JPY 3.367bn

These stricter filters do not improve total portfolio max DD.

### Independent-window / cross-venue robustness

Aster pre-formal:
- 2025-07-31 to 2025-08-10
- 1 SHORT trade
- M05 == current; no behavior change

Aster post-formal OOS:
- 2026-08-10 to 2026-10-02
- 2 SHORT trades
- M05 == current; no behavior change
- signal 72h returns were -10.8384% and -4.8712%

Independent OKX proxy pre-Aster:
- 2025-01-01 to 2025-07-20
- 21 SHORT trades
- current: 76.19% WR / PF 3.3625 / max DD -14.49% / +121.74%
- M05: **exactly the same 21 trades and metrics**
- a stricter -0.75% filter already starts removing a winning opportunity

Interpretation: M05 did not damage any of the independent windows, but those windows contain **zero cases where M05 changes the decision**. Its +9.7% final-equity lift is still driven by one formal-period event. This is insufficient independent evidence for an immediate Production logic change.

## Structural 2% re-break variant

R10: when the 72h trend is weak (> -3%), require a 2% setup-low re-break.

- standalone formal metrics improved
- raw R0 signal generator was proven exact against all 44 formal PENGU SHORT candidate timestamps
- R10 removes two of those timestamps and adds none
- exact integrated replay after that candidate filtering produced **the exact formal baseline: JPY 4.067bn / PF 2.96018 / DD -12.9646%**

The removed R10 candidates were not portfolio-admitted in the formal integrated path, so R10 creates no integrated benefit.

Decision: **do not promote R10**.

## Final recommendation

1. Q102: keep final target unchanged; HIGH_VOL SHORT stays 0.60x.
2. V12: keep current logic; reject new BTC 12h/24h veto.
3. PENGU: keep current Production logic for now.
4. M05 is the only material research candidate. Treat it as a **shadow/telemetry candidate**, not a Production gate, until more live/forward examples accumulate where the completed-H1 72h return is in the near-flat region and the rule actually changes a decision.
5. Do not use -1%, -4%, -5%, or other broader 72h filters; exact integrated replays show material opportunity loss without total-DD benefit.

No LIVE/VPS/Production trading logic was changed by this research.
