# Five improvement research implementation plan

Goal: complete user-authorized five-way research and deploy only independently supported changes.
Architecture: standalone research policies layered on hash-pinned current-source model; original engines, market data and Production untouched during comparison.
Tech: Python standard library, existing Python price model, TypeScript M05 tests.
Spec: docs/research/five-improvements-20261008-design.md
Execution: inline, as requested by user.

Global constraints: current FET5%/+3%, Q102 HVS0.60x, completed bars only, observed venue constraints, 365d, initial JPY10000, no deposits. Results are H1 reference models.
Review focus: future-bar leakage; two same-strategy losses masquerading as cross-strategy; gap/stop activation ambiguity; earlier exits not reflected in funding/preemption; small confidence groups/selection leakage.

- [x] Audit M05 outcome branch and VPS state. Run existing outcome and parity tests. Record exact live/UI SHA and row completeness; activate observation-only outcome code only through existing deployment transaction.
- [x] Add failing research-policy tests for distinct-loss governor, reversal, exact time-window boundary, missing price, next-bar trailing activation and gap exit.
- [x] Implement pure policies, run all research tests.
- [x] Reproduce current-source venue10bps baseline exactly before comparing alternatives; assert wallet accounting and ownership.
- [x] Run FET trailing/momentum and Q102 route variants by changing only earlier planned exit, rerun portfolio. Report admitted MFE/MAE/giveback and candidate changes.
- [x] Run6/12h governor x0.60/0.75 with event-local loss history and exposure; log every trigger and rerun portfolio. Check BTC previous/current3h and distinct crypto strategies.
- [x] Evaluate ex-ante confidence feature rules with temporal split, minimum30 training trades, held-out Wilson interval, independent counts. Do not promote undersampled class.
- [x] Stress promising independent candidates10/20/30bps, inspect ledger deltas and monthly DD clusters.
- [x] Save sources, summaries, input hashes, scope limits and rejected alternatives; verify git diff and push branch, confirm remote SHA. Report any incomplete LIVE activation explicitly.

Forward 20–30 candidates: collection runs persistently; zero candidates at installation. Future market observations are not completed retrospective work.
