# Latest Production SHA monthly BT

This directory contains the corrected one-year, no-DCA, compounded H1 replay
for Production runtime `e8cc2e73f8d3981d708ee52f013241597c038b10`.

## Status

`COMPLETE_CURRENT_SHA_POLICY_CERTIFIED_H1_CAUSAL_PRICE_MODEL_DD21_DESIGN_ONLY`

The operator clarification is explicit: DD21 is a design/evaluation upper
bound, not a V12 entry-stop rule. The corrected replay therefore does not
reject new V12 entries after DD21. It reports whether the portfolio exceeded
the design threshold.

Primary 10bps result:

- Initial capital: `JPY 10,000`
- Recurring contribution: `JPY 0`
- Final equity: `JPY 222,196,830.18350622`
- Net profit: `JPY 222,186,830.18350622`
- Total return: `2,221,868.301835062%`
- Geometric monthly equivalent: `130.2651188595402%`
- Profit factor: `4.326953769851883`
- Maximum H1 mark-to-market drawdown: `-28.480497015241745%`
- Win rate: `69.97558991049634%`
- Closed trades: `1,229`
- Accounting reconciliation: `PASS`

The human-readable analysis is in `LATEST_BT_REPORT.md`. The corrected
canonical replay output is `replay-corrected-1/`. The older `replay-1/`
directory is retained as historical pre-correction evidence and is not the
current result.

## Contract

- Period: `2025-08-10T00:00:00Z` through `2026-08-10T00:00:00Z`
- Initial capital: `JPY 10,000`
- Monthly contribution: `JPY 0`
- Compounding: enabled
- Strategies: V12, PENGU, Q102, V52, FET, HYPE, IDLE and RESIDUAL
- Primary cost: `10bps` round trip
- Cost stresses: `20bps` and `30bps` round trip
- Replay mutations: orders `0`, cancels `0`, position changes `0`
- V12 DD21 trade-stop gate: **not applied**
- V12 DD21 design threshold breach: **reported**

## Current-runtime adaptations included

- V12 V4 `V2_M150_D05_CORE_NATIVE`, 41 routes
- V12 Gross `3.0x`, Recovery Gross `2.5x`
- V4 entry authority Crypto `3.5x`, Total `4.75x`
- Peer entry authority Crypto `3.0x`, Total `4.25x`
- DD21 retained as design/evaluation threshold only
- TIME-family fixed `8%` emergency STOP
- PENGU `COMBINED_FILTERED_Q60_DD17_H72`, accepted-entry Gross `1.0x`
- Q102 current family/side sizing with BRK disabled
- FET `BRK48_VOL10_RET15`, Gross `1.0x`
- Aster venue setting `5x Cross` (not strategy Gross `5x`)

## Provenance and exactness boundary

Historical candidate rows preserve their original runtime SHAs
(`dbf845...` and `ce1edee...`) and are not relabeled as `e8cc...`. They are bound
to the target runtime through checked-in route/source/exit parity evidence, the
target Git-object hashes for all current policy files, raw Aster H1/funding
hashes, and current-policy causal re-evaluation. See
`replay-corrected-1/provenance-manifest.json`.

This is the corrected current-SHA policy replay under the operator's DD21
semantics. It is not a reconstruction of historical L2 order books, venue
latency, partial/unknown execution or historical minQty/minNotional read-back
behavior.

The checked-in V4 lifecycle source still contains executable DD21
entry/reservation guards. That source-level contract conflict is recorded in
the summary and must be reconciled before this BT can be called exact live-code
parity. This task changed the research interpretation only; it did not modify
VPS or Production runtime.

## Determinism

The corrected replay was run twice into independent output directories. All 15
canonical ledgers/summaries matched byte-for-byte. The corrected canonical
hash-manifest SHA-256 is:

`0b49802f128c38c3ec467b76bf123afd4fe64dbc926c85975efc43b665659f27`

The old DD21-entry-stop output is not the canonical result. It remains in
`replay-1/` as historical pre-correction evidence; its code and metrics are
also recoverable from the previous Git commit.

## Reproduction

Use the bundled Python runtime and the three source roots recorded in the
provenance manifest:

```powershell
& '<bundled-python>' scripts/research/run_e8cc_exact_no_dca_bt.py `
  --repo-root . `
  --research-root '<DisDex-five-improvements-20261008>' `
  --aster-market-root '<market-Aster-H1-funding-and-manifests>' `
  --v52-ledger-root '<v52-SHA-verified-original-ledger>' `
  --output-dir docs/research/results/exact-current-sha-monthly-bt-20261014/replay-corrected-1
```

A valid result must retain the exact target SHA binding, one initial JPY 10,000
contribution, zero recurring contributions, `accounting_reconciliation=PASS`,
Q102 BRK accepted count zero, zero trading mutations, and
`v12_dd21_trade_gate_applied=false`.
