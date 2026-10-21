# Task 9 primary-source evidence audit (2026-10-21)

## Status
BLOCKED_INCOMPLETE_SOURCE_COVERAGE. This audit does not constitute the full eight-logic causal dynamic integrated backtest, formal baseline parity, loss reduction, or Production certification. Research-only, no LIVE/HP/account changes.

## Source-backed results
The preserved run-1 LATEST_20261017_BASELINE historical research source was scanned without modifying inputs. Candidate-to-modeled-entry and candidate-to-trade ID equality passed for both scenarios.

| Measure | 10bps | 30bps |
| --- | ---: | ---: |
| Observed candidate decision rows | 3,185 | 3,185 |
| Accepted modeled entries | 1,310 | 1,307 |
| Rejected portfolio decisions | 1,859 | 1,862 |
| Verified preallocation exclusion rows | 16 | 16 |
| Portfolio modeled event rows | 7,836 | 7,827 |
| Candidate/entry/trade ID sets match | YES | YES |
| Historical fill verified modeled entries | 0 | 0 |
| H1 saved market symbols in inspected input path | 6/35 | 6/35 |
| Source-backed priority + validity expiry for all actionable rows | NO | NO |
| Rejected quantity and entry equity for all rows | NO | NO |

The six H1 files found in the inspected 2026-10-19 reconstructed baseline inputs are BNBUSDT, BTCUSDT, ETHUSDT, HYPEUSDT, PENGUUSDT and SOLUSDT. Their stored hourly timestamps were continuous in each file, but these files do not span all 35 symbols of the candidate source. The other 29 symbols are not present **in the inspected input directory**; this does not prove that they exist nowhere else. V52 stock proxy instruments require their own independently sourced prices and basis logic.

Historical fill verification is FALSE for every modeled entry observed: these are research price-model executions, not venue-signed executions.

## Provenance SHA256
| Input | 10bps | 30bps |
| --- | --- | --- |
| candidate-decisions.jsonl | eac68287e6f4e644c588b8689ce1dc67226abccea21bea09e29c0aeda0c1a3e2 | 77087b72c7e9279d001b58e351d7e932a9b3dabcb58d9ccbf7f1a0fd28a7c5d1 |
| portfolio-events.jsonl | 4020ef8181944999d59abc161444299061f225f4cde56e7b47745e00314a4166 | b859f95983cbcc4587dcc83ae15f4ff330d545cc32596b2f30fe7611ac06c0e7 |
| portfolio-trades.jsonl | 6c7a2f6d73336109af852c233bfdcb9013cbe73ac06f83070b39b73306d20e78 | 9cb346e7c4e341bd277de8b60256dd6e8efe9b7f266b54bc52ed5ccff0112e05 |

## Economic/MTM fail-closed guard
- The Task 9 runner must not report DD=0 solely because it has an initial cash/equity point. A confirmed chronological MARK replay must exist in IS, OOS and independent Holdout before economic metrics are generated.
- Input market prices are not themselves proof that the portfolio was marked to market. The current runner does not produce the required source-backed MARK event stream for this historical dataset and remains blocked.
- The guard is regression-tested with a complete synthetic eight-strategy candidate set and nonempty, but insufficient, market data.

## Reproducibility and next requirements
- Code: scripts/dd-reduction/audit-task9-existing-evidence.py
- Synthetic self-contained tests: scripts/dd-reduction/test_task9_existing_evidence.py
- Compact machine-verifiable evidence: primary-evidence-10bps.json, primary-evidence-30bps.json
- Raw audit JSON stays outside Git under C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-21_task9_primary_source_evidence/
- Formal candidate generation requires independent 35-symbol time-series + V52 non-crypto pricing manifests, strategy configuration hashes, entry-validity/priority/tie-break, preemption evidence, dynamic quantity/lot-filter and wallet MTM events, funding/protection/execution chronology.
- Only after source-backed time-sequential readmission, stop-released gross reallocations, compound sizing, exact baseline parity and independent IS/OOS/Holdout can economic DD and strategy adoption be measured.
- Do not fabricate rejected quantity from gross/entry price or classify the modeled fills as verified venue fills.
