# V12 V2_M150_D05_CORE_NATIVE — full multi-strategy integrated BT reproduction (2026-10-09)

**Status: REPLAY VERIFIED / CURRENT VPS PRODUCTION PARITY UNVERIFIED / RESEARCH ONLY.**  
No VPS, HP, existing LIVE logic, real order, portfolio cap, or production runner was altered.

## Scope and exact identity

- Research configuration: `V2_M150_D05_CORE_NATIVE`.
- Primary research source: `scripts/research/run_v12_v4_priority_gross_v2_sweep.py` and two-pass entry/exit repairs.
- Full-year source: 2025-08-10 to 2026-08-10, H1 historical price model.
- Initial contribution: JPY 10,000; model has **one** deposit event, not a verified live account and not JPY 130,000.
- Route preference: full-development-year `route-priority-score.json` rank, **retrospectively optimized / hindsight leakage**. Tier gross multiplier 1.5x; D tier 0.05x; Core requested gross and rank native.
- Caps: Recovery family **2.50x** / V12 **3.00x** / Crypto **3.50x** / portfolio Total **4.75x**. Gross is not the exchange leverage setting.
- Input strategy streams: **V12, PENGU, Q102, V52, HYPE_LONG, FET, IDLE, RESIDUAL**. Global ownership and Gross contention are part of the modeled replay.
- **Caveat:** The actual *currently deployed* VPS SHA, runner settings, exact funding/routing versions, and current state were NOT read back (SSH authentication/connection was unsuccessful). Therefore the 8-stream replay cannot be certified as production-identical or described as a new LIVE validation.

## Fresh replay — 3 modeled round-trip cost conditions

| Metric | 10bps | 20bps | 30bps |
|---|---:|---:|---:|
| Full-portfolio final equity (JPY) | 291,326,102.62 | 231,193,740.03 | 174,749,524.32 |
| Portfolio maximum mark-to-market DD | **-20.4200%** | **-20.9659%** | **-18.3888%** |
| Full-portfolio profit factor | 4.0490 | 3.6557 | 3.2776 |
| Portfolio closed trades | **1,222** | **1,224** | **1,218** |
| V12 accepted/closed legs | **828** | **828** | **824** |
| Full-portfolio win rate | 71.60% | 69.93% | 68.31% |
| Accounting/deposit reconciliation | PASS | PASS | PASS |
| Historical venue L2 fill verified | NO | NO | NO |

Note that modeled DD at 30bps improves over 20bps: cost changes affect trade selection, capital use and compounding path, not simply subtract fixed returns. This is NOT an empirical guarantee of DD robustness.

## Strategy decomposition — full portfolio 10bps

| Strategy | Trades | Win rate | Profit factor | Modeled net PnL (JPY) |
|---|---:|---:|---:|---:|
| V12 | 828 | 73.07% | 4.901 | +159,308,905 |
| PENGU | 67 | 74.63% | 3.448 | +20,472,029 |
| Q102 | 136 | 63.97% | 2.026 | +21,286,735 |
| V52 | 87 | 81.61% | 27.256 | +37,571,403 |
| HYPE_LONG | 28 | 60.71% | 3.459 | +46,856,521 |
| FET | 7 | 85.71% | 25.205 | +4,125,732 |
| IDLE | 47 | 55.32% | 3.282 | +6,123,652 |
| RESIDUAL | 22 | 59.09% | 0.578 | **-1,381,582** |

PnL is strategy attribution from the replay; final equity has FX cash translation and deposits, so summed strategy PnL is not identical to final equity.

- **326** calendar days had at least one trade entry for the whole portfolio, according to the integrated case run. This does not establish a trading opportunity every calendar day for V12.
- V12 10bps: 605 wins / 223 losses, win rate 73.07%, PF approx 4.90.
- V12 30bps: 824 accepted legs, win rate 68.93%.
- RESIDUAL is the only negative 10bps strategy; there is no authorized automatic exclusion or changed ownership without a separately recalculated full portfolio BT.

## Deterministic reproduction

The fresh isolated-output replay, using `run_v12_v2_integrated_confirm_20261009.py`, completed 10/20/30bps with `ALL_SCENARIOS_ACCOUNTING_AND_DEPOSIT_AUDIT_PASS`.

**12/12 historical-vs-fresh SHA256 pairs match exactly** across three modeled costs:

- `portfolio-trades.jsonl`
- `candidate-decisions.jsonl`
- `portfolio-events.jsonl`
- `metrics.json`

For each cost, replayed final equity, max DD, number of closed trades, and strategy set also match. The hashes and file sizes are in `integrity-manifest.json`. Source cases reside under:

- `docs/research/results/v12-v4-priority-gross-v2-sweep-20261009/cases/V2_M150_D05_CORE_NATIVE/` (10bps)
- `docs/research/results/v12-v4-priority-gross-v2-stress-20261009/cases/V2_M150_D05_CORE_NATIVE/` (20/30bps)

Full fresh ledgers are stored on the owner PC (not committed due large size). This Git commit stores the executable rerun script, compact output, manifest and audit.

## Important production-parity blockers

1. **Current VPS implementation source of truth is not available in this audit**. Comparing only repo research files to live runner behavior is insufficient to certify parity, particularly if FET/PENGU/HYPE/Q102 changed after the modeled dataset was frozen.
2. `strict_quantity=false`: historical venue minimums, partial fills, precision, margin and liquidity have not been fully independently verified from the actual live venue filters.
3. Q102 source scope is `FIXED_HIGH_VOL_STREAM_PLUS_NON_COLLIDING_S34_DELTA_NOT_FULL_SELECTOR_RETRAIN` (26 delta candidates), NOT an independently reconstructed unrestricted full live selector for the whole period.
4. V52 historical model was marked complete and funding verified **within the existing research replay**, not an external live/exchange execution certification.
5. Full-year route priority uses the period being evaluated, which can inflate modeled results. Separate 2026-08-11 to 2026-10-04 Y06 route-edge test: 102 entries, win rate about 37.25%, PF 0.2995 at 10bps. **This exact high-profit case is not demonstrated robust in forward conditions**.
6. Portfolio max DD is below -20% at 10bps and 20bps. Do not treat the 30bps -18.39% as resolving the DD concern.
7. Current live runner/equity/order lineage readback, symbol ownership, actual 5x Cross, pending margin and restart continuity require an operator-side inspection before Work changes LIVE.

## Deployment / HP

- This research replay **does not authorize real trading** or hot-switch to this high-profit case.
- Keep Production/LIVE unchanged. For a later handoff, reconcile actual VPS runner versions and full actual position state first, and show research benchmarks separately from live metrics on HP.
- New candidate implementation/shadow work is separate from this verified replay; do not confuse a TypeScript unit-test pass with causal-to-live order-path parity.

**Result classification: research reference reproduced exactly; not yet a certified current-VPS production-equivalent BT.**
