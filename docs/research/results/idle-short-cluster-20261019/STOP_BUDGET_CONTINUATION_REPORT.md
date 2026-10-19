# Idle SHORT basket loss budget / UTC daily-loss research continuation — 2026-10-19

**STATUS: RESEARCH ONLY — NO LIVE SETTINGS, POSITION, STOP, SHARED RISK LATCH, OPERATOR ARTIFACT OR RELEASE CHANGED.**

Source parent: PR #257 / `4d422b5f54c6e0efb349d1906cf7d7168c3bd800`
Reproduction:
`python research/idle_short_stop_budget_stress_20261019.py --output docs/research/results/idle-short-cluster-20261019/STOP_BUDGET_STRESS_GRID.json`

## What was actually re-run

1. Hash-pinned 61 accepted Idle SHORT intents + 61 net returns + 393 causal feature rows; original 61 / 48 winners / 13 losers and 15 frozen filter variants matched.
2. An 18-case **STATIC INITIAL STOP-RISK PROXY**: nominal price STOP at 10%, optional adverse execution gap 0/1/2%, risk budget 10/12.5/15/17.5/20/22.5% of account equity, approximated in the fixed ledger by allowable Idle gross = budget/(10%+gap).
3. The 2026-10-19 JUP/TAO/TIA three-position scenario using logged original entry quantities and entry prices, approximate account wallet 61.82 USDT. In the scenario the entry ordering of simultaneous TAO/TIA is **not yet venue-certified**.
4. 9/9 synthetic UTC accounting, portfolio risk and signed STOP-floor regression tests PASS.
5. Separately, 25/25 **older** Trail0.20+Idle+DOGE/AVAX integrated manifest files hash-verified in canonical LF; old 10/20/30bps portfolio ledger statistics reproduced. These are **not the new Gate results** and **not current V12 V4/Exit Overlay**.

## Historical frozen-proxy results (10bps)

| Budget | Gap | Trades | Wins | Weighted return sum | Excluded winner/loss |
|---|---|---:|---:|---:|---|
| No new cap | 0 | 61 | 48 | +76.1829% | 0 / 0 |
| 10% | 0 | 52 | 40 | +57.7782% | 8 / 1 |
| 12.5% | 0 | 57 | 45 | +69.8539% | 3 / 1 |
| 15% | 0 | 57 | 45 | +69.8539% | 3 / 1 |
| 20% | 0 | 60 | 47 | +75.0291% | 1 / 0 |
| 22.5% | 0 | 61 | 48 | +76.1829% | 0 / 0 |
| 15% | 1% | 57 | 45 | +69.8539% | 3 / 1 |
| 20% | 1% | 57 | 45 | +69.8539% | 3 / 1 |
| 22.5% | 1% | 60 | 47 | +75.0291% | 1 / 0 |
| 15% | 2% | 57 | 45 | +69.8539% | 3 / 1 |
| 20% | 2% | 57 | 45 | +69.8539% | 3 / 1 |

Complete 18 cases and 10/20/30bps contributions in `STOP_BUDGET_STRESS_GRID.json`. Because historical approved positions are only 1.0/0.25 gross, this proxy is discontinuous: a tiny gap assumption can jump from preserving 60 entries to 57. These are ex-post frozen accepted intents. **It cannot measure expected risk-adjusted return, formal cumulative final equity, actual resident STOP fills, or full-portfolio MTM DD.** Do not choose a 15% budget merely because it intercepts this incident; validate prospectively and under historical actual STOP readings.

## 2026-10-19 three-position illustration

At original fills, signed position sizes as reported: JUP 22 at 0.2803, TAO 0.241 at 256.08, TIA 103 at 0.5947; total entry notional 129.13598 USDT (approximately 2.09x versus 61.82 USDT wallet).

| Initial STOP adverse price move | Proxy potential basket loss | Approx. wallet risk |
|---|---:|---:|
| 10% (0 gap) | 12.9136 USDT | 20.8890% |
| 11% (1% gap) | 14.2050 USDT | 22.9779% |
| 12% (2% gap) | 15.4963 USDT | 25.0668% |

With an illustrative 15% budget and **JUP first**, only one of TAO/TIA could be admitted at 0–2% gap, conditional on the actual candidate ordering and all fills occurring at the modelled original quantities. This is not proof of actual venue admission decisions; historical STOP prices, fills, cross-strategy existing SHORT risk and wallet at exact decision clock must be read back first.

The portfolio unrealized PnL was logged at **+0.055 USDT immediately before** the H1 second-entry batch; therefore a naïve “underwater existing SHORT” veto alone might not stop the batch. Sign-sensitive existing Idle-only PnL is not certified by the portfolio aggregate.

## LIVE admission contract to test, not deploy

Before each Idle SHORT request, read signed/open venue positions, pending orders, fresh mark/quote, and actual resident reduceOnly STOP quantity/price/read-back. Compute a **portfolio-side** adverse price loss to resident STOP from current mark, not from an arbitrary initial 10% proxy. Stress adverse price jumps, execution fees and pending orders, and allocate an atomic same-side **reservation** under a single shared account lock so two runners cannot each assume the same headroom.

Compute separately: current MTM-to-STOP equity erosion; guaranteed PnL at STOP versus original entry (locked-profit floor); net existing SHORT PnL after fees; and portfolio-wide exposure/gross/margin guards. A SHORT with floating gain at mark 95 versus entry 100 can still lose if its resident STOP remains at 101, while STOP at 98 would lock gross profit 2 per unit. Never offset a new loss with unverified/uncancellable claimed protected profit. No touching, weakening or replacing existing STOP is authorized by this research.

Rank same H1 candidates **before** checking forward outcome, using finalized H1 causal score/edge, ex-ante risk and stable tie-break; no retrospective winner selection. One-per-H1 remains a comparator, not formally adopted: it deleted a historical winner. For regular 1.0x 10%-STOP trades a blanket 7.5% STOP-risk budget would veto nearly all fresh entries; avoid conflating the 7.5% *daily-loss entry latch* with total open STOP risk.

## UTC daily PnL accounting

Candidate accounting invariant for a single UTC day with stable mark reconciliation:

`daily_incremental_pnl = realized_since_UTC00 + fees_since_UTC00 + funding_since_UTC00 + current_open_unrealized - UTC00_open_unrealized`

Deposits, withdrawals, intra-day transfer normalization, midnight position snapshots, partial fills, overnight exits, and fee unit conversions must also be reconciled and tested before use. Example: portfolio loss -6 at UTC00, -7 later today = -1 incremental daily MTM (not -7). If the old position closes for realized -8 and open U becomes 0, incremental day movement is -2 (not -8). **Separate absolute account equity drawdown/STOP-risk guard remains active**. Migration must not unset an already tripped 7.5% latch without separately authorized reconciliation and operator action.

## Integration blocker and research priority

The isolated Windows Git worktree includes frozen 61 returns and an old portfolio event ledger, but it does **not** contain `normalized/aster/klines` H1 market files needed by `research/idle_priority_fixed_intent_dynamic_gross.py`. The earlier 1,284-position baseline events and symbol-level H1/5m prices, current V4/Exit Overlay and signed STOP history must be assembled before a fully causal **current-production** integrated BT is possible. The old ledger's baseline 10/20/30bps results do not imply changed-gate DD.

Next formal matrix: current V4+Q102+HYPE+Idle+PENGU+V52+FET; stop-risk budgets 15/20% with 0/1/2% stress, protected-profit add-on, loss-veto, one H1, signal-age 5/10/15/30 mins; re-admission of peer strategies; quantity/minNotional and rate-budget latency. Report 10/20/30bps actual final asset JPY, max H1 MTM DD, PF, WR, independent trades and skipped winners; forward untouched cases with triggered signals after 2026-08-10. **Until then, no promotion to LIVE.**

## Repro commands

```powershell
python research/idle_short_cluster_guard_frozen_replay_20261019.py --repo-root .
python research/idle_short_stop_budget_stress_20261019.py --output docs/research/results/idle-short-cluster-20261019/STOP_BUDGET_STRESS_GRID.json
python -m unittest tests/test_idle_stop_budget_and_utc_daily_20261019.py -v
python research/verify_lf_legacy_idle_anchor_20261019.py
```
