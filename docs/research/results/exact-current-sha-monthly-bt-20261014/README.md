# Latest Production SHA monthly BT

This directory contains the completed one-year, no-DCA, compounded H1 replay
for Production runtime `e8cc2e73f8d3981d708ee52f013241597c038b10`.

## Status

`COMPLETE_CURRENT_SHA_POLICY_CERTIFIED_H1_CAUSAL_PRICE_MODEL_NOT_L2_VERIFIED`

The primary 10bps result is:

- Initial capital: `JPY 10,000`
- Recurring contribution: `JPY 0`
- Final equity: `JPY 14,452,316.093050238`
- Net profit: `JPY 14,442,316.093050238`
- Total return: `144,423.16093050237%`
- Geometric monthly equivalent: `83.36993074854218%`
- Profit factor: `2.31346410128944`
- Maximum H1 mark-to-market drawdown: `-27.660125106894597%`
- Win rate: `64.86486486486487%`
- Closed trades: `666`
- Accounting reconciliation: `PASS`

The human-readable analysis is in `LATEST_BT_REPORT.md`. The canonical replay
output is `replay-1/`.

## Contract

- Period: `2025-08-10T00:00:00Z` through `2026-08-10T00:00:00Z`
- Initial capital: `JPY 10,000`
- Monthly contribution: `JPY 0`
- Compounding: enabled
- Strategies: V12, PENGU, Q102, V52, FET, HYPE, IDLE and RESIDUAL
- Primary cost: `10bps` round trip
- Cost stresses: `20bps` and `30bps` round trip
- Replay mutations: orders `0`, cancels `0`, position changes `0`

## Current-runtime adaptations included

- V12 V4 `V2_M150_D05_CORE_NATIVE`, 41 routes
- V12 Gross `3.0x`, Recovery Gross `2.5x`
- V4 entry authority Crypto `3.5x`, Total `4.75x`
- Peer entry authority Crypto `3.0x`, Total `4.25x`
- V12 account maximum-drawdown entry Gate `21%`
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
`replay-1/provenance-manifest.json`.

This is therefore the current-SHA policy-certified H1 causal economic replay.
It is not a reconstruction of historical L2 order books, venue latency,
partial/unknown execution or historical minQty/minNotional read-back behavior.

## Determinism

The complete replay was run twice into independent output directories. All 15
canonical ledgers/summaries matched byte-for-byte. The canonical hash-manifest
SHA-256 was:

`d47f433bc79e545ec9fea1bd3839bf37e33ec1907f6d042af35f8b5f93495844`

The second bulky output copy was removed after writing
`independent-replay-verification.json`; the canonical `replay-1/` remains.

## Reproduction

Use the bundled Python runtime and the three source roots recorded in the
provenance manifest:

```powershell
& '<bundled-python>' scripts/research/run_e8cc_exact_no_dca_bt.py `
  --repo-root . `
  --research-root '<DisDex-five-improvements-20261008>' `
  --aster-market-root '<market-Aster-H1-funding-and-manifests>' `
  --v52-ledger-root '<v52-SHA-verified-original-ledger>' `
  --output-dir docs/research/results/exact-current-sha-monthly-bt-20261014/replay-1
```

A valid result must retain the exact target SHA, one initial JPY 10,000
contribution, zero recurring contributions, `accounting_reconciliation=PASS`,
Q102 BRK accepted count zero, and zero order/cancel/position mutations.
