# V12 score gap audit, 2026-09-26 — RESEARCH / no LIVE changes

## Reproduced code defect
The frozen production strong-regime score path accepts [0.15,0.70] with ATR >=0.014 and ordinary >=1.4649. It rejects (0.70,1.4649) even if BTC direction and ATR align. This is a bounded-route eligibility gap; its missed realized PnL is **not yet established**. In NEUTRAL, the ordinary 1.4649 threshold applies.

## Changes on this branch
- Read-only diagnostic snapshot records volume, momentum, edge, BTC direction, score / strong-band / ATR, Rank and win-rate outcomes simultaneously. The original executable `candidateEligibility`, `buildV12Signals`, HC1.75 and risk caps are unchanged.
- A base-eligible candidate outside the actual Top3 is now marked `NOT_TOP3_SELECTED` in UI-only observability; this fixes misleading `signalEligible=true` for never-selected candidates. It does not affect the executable selector.
- Annual public Aster H1 read-only research tests frozen, pure score-gap closure, isolated score / volume, and joint variants. Frozen baseline must match the production selector at **every** evaluable H2 observation or the job fails.
- Annual results are *overlapping forward 24h proxies*, plus heuristically separated 24h/46h candidate episodes. These are NOT actual positions, realized exits, integrated PnL, PF, DD, nor a forecast of orders per day.

## Formal integrated five-logic release gate
The source-of-truth contract is `docs/implementation/FINAL_INTEGRATED_GROSS_LIVE_CONTRACT_20260922.md`, for 2025-08-10 through 2026-08-10, monthly contributions (JPY 130,000 total), ORIGINAL five-logic engine and historical datasets. Re-run **exact baseline first**: NORMAL JPY 1,448,665,533.02 / PF 4.14112335 / DD -19.61179353%; SEVERE JPY 75,982,803.52 / PF 3.01497717 / DD -19.97886021%. Then evaluate gate variants with precisely the same sources, sizing, Gross reservations, PENGU COMBINED_FILTERED 1.0, FET 2.25, Q102 causal governor, V52 stock, stop/TP, fees/slippage, actual slot competition and severe stress. Both scenario PF, PnL, max DD, monthly ledgers, and per-logic opportunity displacement must be recorded. Research signal counts alone cannot approve a LIVE relaxation. Require SEVERE DD <20% and no worsening of baseline unless the user explicitly accepts the measured tradeoff.

## Deployment
No production service, order path, master branch, live threshold, or VPS file is modified here. The UI package is a separate lineage: it must consume `gateChecks` from a verified production snapshot rather than recomputing a divergent approximation.
