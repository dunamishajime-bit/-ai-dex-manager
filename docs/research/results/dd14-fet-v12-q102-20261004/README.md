# DD14 FET/V12/Q102 Research Promotion Candidate — 2026-10-04

## Status

**RESEARCH / PROMOTION CANDIDATE ONLY. NOT DEPLOYED.**

This branch freezes the best 1-year integrated backtest configuration found after prioritizing drawdown reduction while preserving the HYPE75 + PENGU1.0 production baseline.

## Frozen candidate

- PENGU: fixed entry Gross **1.0**, current Long/Recovery unchanged, Short adds only the **limited 2% structural re-break** guard.
- HYPE: existing **75 bps EMA240 24h-slope filter** unchanged.
- Q102: **HIGH_VOL SHORT <= 0.70x**, **REV SHORT <= 1.25x**, **PB LONG <= 2.00x**. Other family/side sizing remains on the existing family contract.
- FET: entry requires **72h return >= +2%** and any completed FET exit starts a **24h re-entry cooldown**.
- V12: after **6 consecutive realized losses on the same side**, that side alone is blocked for **6h**. The opposite side remains eligible. The streak is durable and resident STOP/TP fills are included.
- V52 / IDLE / RESIDUAL: unchanged.

## Integrated BT

Period: **2025-08-10 through 2026-08-10**  
Cost model: **10 bps**  
Capital/accounting/ownership engine: same formal integrated engine and market archive used by the 32.8B-yen HYPE75/PENGU1.0 comparison.

| Metric | Result |
|---|---:|
| Final equity | **JPY 3,270,844,178.21** |
| Profit factor | **2.77520533** |
| Maximum MTM drawdown | **-14.115749%** |
| Closed trades | **1,359** |
| Ownership conflicts | **0** |
| Accounting reconciliation | **PASS** |

Strategy trade counts in this final path: V12 999 / Q102 129 / PENGU 65 / V52 85 / HYPE 26 / IDLE 36 / RESIDUAL 11 / FET 8.

## FET outcome

With the 72h-quality gate + 24h re-entry cooldown, FET is **8 trades / 7 wins / 1 loss (87.5%)** in the final path. The three losing `FET_24H_TIME_EXIT` cases that motivated this repair are removed. The remaining loss is a portfolio pre-emption outcome rather than a 24h time-exit loss.

## V12 loss-streak outcome

In the post-Q102/FET path the uncontrolled V12 path reached a maximum loss streak of 10. The 6-loss/6h same-side cooldown reduces final V12 trades to 999 and leaves **632 wins / 367 losses**, with the tested final integrated equity above the FET-only path. This is the starting ledger for the next 367-loss decomposition.

## Evidence

- `final-summary.json` — final integrated scenario summary.
- `metrics.json` — complete scenario metrics/accounting output.
- `portfolio-trades.jsonl` — 1,359 final accepted/closed trades.
- `source-manifest.json` — hashes, source SHA, frozen rules and validation state.
- `comparison.csv` — selected progression from the current 32.8B-yen baseline to the DD14 candidate.

## Validation

- DD14 contract tests: **3/3 PASS**
- FET/Q102/V12 targeted regression tests: **26/26 PASS**
- Additional V12 recovery/reservation tests: **8/8 PASS**
- Q102 causal V4 signal selftest: **PASS**
- PENGU V2 TypeScript typecheck: **PASS**
- Full repository TypeScript typecheck: **PASS**

## Safety

No VPS service, Production release, LIVE runner, exchange order, or runtime state was changed by this research branch.
