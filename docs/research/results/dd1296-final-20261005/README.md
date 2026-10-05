# DD12.96 Final Integrated Backtest Ledger — 2026-10-05

Status: **RESEARCH VALIDATED / PRODUCTION HANDOFF / NOT DEPLOYED**

## Final integrated 10 bps result

- Final equity: **JPY 4,067,358,397.424793**
- Profit factor: **2.960180377096512**
- Maximum MTM drawdown: **-12.96457052048714%**
- Closed trades: **1,358**
- Ownership conflicts: **0**
- Accounting reconciliation: **PASS**
- Period: first entry 2025-08-10T04:00:00Z; last exit 2026-08-10T00:00:00Z

## Final logic target

- PENGU 1.0, COMBINED_FILTERED, existing limited 2% structural re-break.
- HYPE75 unchanged.
- Q102 HIGH_VOL: LONG **1.00x**, SHORT **0.60x**.
- Q102 REV: LONG **1.50x**, SHORT **1.25x**.
- Q102 PB LONG: **2.00x**.
- Q102 MR / BRK default caps: **0.75x**.
- Q102 FET BRK SHORT exhaustion: block when causal FET 72h return <= **-12%**.
- FET BRK48 LONG: require causal 72h return >= **+2%** and block FET re-entry for **24h after any FET exit**.
- V12: after **6 consecutive losses in the same side**, block only that side for **6h**.
- V12 AVAX Rank1 SHORT rebound gate: BTC 3h must still be negative and directionalRelative3h <= **-0.75%**.
- V12 ATOM exhaustion gate: block when directionalRelative3h >= **+0.603%**.
- V12 AVAX Rank1 LONG weak-momentum gate: block when directionalReturn24h <= **+1.65%**.
- V52 / IDLE / RESIDUAL unchanged.

See `docs/implementation/FINAL_PRODUCTION_TARGET_DD1296_20261005.json` for the machine-readable contract.

## V12 outcome

- Trades: **995**
- Wins: **643**
- Losses: **352**
- Win rate: **64.62%**

The loss count improved from the earlier 367-loss reference while final equity increased and drawdown fell below 13%.

## Strategy PnL

- V12: JPY 1,494,763,113.376527
- Q102: JPY 724,001,822.5836381
- PENGU: JPY 181,883,587.3770706
- V52: JPY 736,927,793.0325155
- HYPE_LONG: JPY 200,253,872.30101055
- IDLE: JPY 633,583,350.8213232
- RESIDUAL: JPY 41,155,917.493764095
- FET: JPY 105,252,924.89640824

## Ledger files

- `final-summary.json`: exact final scenario summary.
- `portfolio-trades.jsonl`: complete 1,358-trade model ledger from the final 10 bps scenario.
- `portfolio-trades.csv`: flattened ledger for audit/review.
- `ledger-manifest.json`: SHA256 hashes, row counts and source paths.
- `research-final-allin-bt.py`: exact research composition script used for the final all-in scenario.
- `research-q102-revl-bt.py`: preceding Q102 side-gross search script.
- `research-v12-causal-gate-bt.py`: causal V12 gate research script.

## Important causal-data correction

During validation, an earlier research implementation used `_mark(ts-H)` where the intended feature was the last completed H1 close available at entry. The final candidate corrected this to the entry-boundary causal price (`_mark(ts)`) with lookbacks from that boundary. The result in this ledger is from the corrected causal implementation.

## Deployment rule

This branch is a **handoff branch**, not an activated LIVE release. Codex must rebase/integrate this contract onto the current Production source, implement missing runtime pieces, add tests for every gate and side-specific Gross cap, run the full validation suite, and only then deploy with the existing exact-commit operator approval and fail-closed controls.
