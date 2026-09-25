# Canonical integrated BT parity recovery — verified progress (2026-09-25)

**Status: BLOCKED_MISSING_ORIGINAL_CANONICAL_EVENT_LEDGER. Do not substitute proxy replay, fit headline return, or promote trading changes.**

## Verified historical reference

Original Top3 + FET 1.25x + Q102 Governor 0.30% headline from `docs/research-results/top3-fet-q102gov-integrated-20260920.json`:

| Case | Final equity | PF | Max DD | Trades |
| --- | ---: | ---: | ---: | ---: |
| NORMAL | ¥740,771,278.01 | 4.12008119 | -19.88452049% | 1,195 |
| SEVERE | ¥65,669,109.00 | 3.05645475 | -19.99033133% | 1,036 |

The file is a summary, not the original venue-quality event ledger, and must not be used as generated replay trade data.

## Native production V12 signal recovery — succeeded

- Run: https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36085980285
- Artifact: `native-v12-pure-signal-parity-20260925`
- Immutable hourly Binance historical source borrowed from independent replay (NOT Aster).
- Production PURE `buildV12Signals` from `lib/v12-x1-all.ts` and `config/v12X1AllRuntime.ts` cross-checked candidate by candidate against independent Python H2 implementation.
- 4,380 H2 bars, **1,443 candidate signals**: LONG 523, SHORT 920; Rank1 879, Rank2 534, Rank3 30.
- All candidate identity, side, UTC times, rank, numeric momentum/ATR/score/Gross/protection parameters passed cross-language comparison.
- This proves the pure V12 signal port agrees with the referenced code. It does NOT prove allocator, historical LIVE version, execution, protective exits, trade counts or five-sleeve Production parity.

## Research-only mixed replay — succeeded but NOT formal

- Run: https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36086241227
- Artifact: `independent-native-v12-mixed-replay-20260925`
- Contains real pure V12 signal output, but **PENGU, Q102, FET and V52 proxy/incomplete**; original allocator unavailable.
- NORMAL/current: ¥29,923.73, PF 0.657, DD -69.93%; NORMAL/Q60: ¥27,203.41, PF 0.624, DD -80.56%.
- SEVERE/current: ¥45,697.14, PF 0.800, DD -74.54%; SEVERE/Q60: ¥27,757.14, PF 0.572, DD -83.75%.
- All four accounting ledgers reconcile. SEVERE sometimes exceeds NORMAL because differing costs change occupancy and path-dependent signals; this does not validate original stress assumptions.
- **Do not compare these proxy returns to the original headline or change LIVE configuration based on them.**

## VPS source recovery: diagnostic successfully completed

Initial read-only inventory run `36086669771` failed exit 141 because `find | head` under pipefail traversed duplicate historical releases. Fixed in PR #233. Rerun `36086793904` succeeded, with trading mutations 0.

Focused workspace PR #234/run `36086931624` succeeded and located:
- `/home/deploy/disdex-trading/work/v12-winrate-gates-20260923/.research-state/v12-winrate-gates-20260923/result.json`, 9,827,755 bytes, SHA256 `99e320d855c91b986c691fc7ba1eac93321bc0660bb1ef69eda2901a8f938575`. This is a V12 win-rate-gates research result, NOT verified original Top3 five-sleeve event ledger.
- `/home/deploy/disdex-trading/work/v12-winrate-gates-20260923/docs/research-results/top3-fet-q102gov-integrated-20260920.json`, 8,433 bytes, SHA256 `9e522e7d93a4c3e7023065825d6d5f41688cdd47410c6223d97ed016dbbdd995`. Summary only.
- `/home/deploy/disdex-trading/work/v12-winrate-gates-20260923/docs/research-results/v12-v52-pengu-v2-combined-latest.json`, 245,003 bytes, SHA256 `0675fd17a0a93382d622761e17b4f0a4ab87fa8842fd5273dc3faf51fd7b7177`. Older 3-sleeve historical research result (2026-08-16), not the original 2026-09-20 Top3 integrated five-sleeve event ledger.
- Other observed workspaces had duplicated September historical summaries, not the missing original source.
- Direct `/root/.research-state`, `/var/lib/disdex/research`, and `/home/deploy/.research-state` paths were absent on the VPS.

## Next gate

1. Inspect schema/lineage of the 9.8 MB V12 gate result read-only; extract only research metadata and event counts, do not confuse it with original integrated anchor.
2. Search actual ORIGINAL 2026-09-20 experiment runner/temporary workspace or archived Actions artifact for complete event-by-event Top3/Q102/PENGU/FET/V52 allocation and basis/execution data; retain provenance hash and immutable source copy.
3. Implement/validate Production-specific PENGU COMBINED_FILTERED causal entry and all exit routes, Q102 Causal V4 selector, FET preemption/partial allocation and V52 stock basis/execution pair; original shared Gross reservation and NORMAL/SEVERE stress/fees.
4. Only after all five candidate and execution ledgers exactly reconcile, re-run first original historical anchor and then user-requested new PENGU comparison. Fail closed on missing rows, timeline mismatch, unproven parity or zero executions for nonzero original sleeve counts.

**No VPS trading runner, Aster account, positions, Kill Switch, HP, or LIVE runtime is modified by these research jobs.**
