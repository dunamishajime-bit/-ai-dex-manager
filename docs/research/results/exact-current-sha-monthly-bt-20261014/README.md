# Exact current-SHA monthly BT

This result directory is reserved for the one-year replay of the exact current
Production runtime `e8cc2e73f8d3981d708ee52f013241597c038b10`.

## Contract

- Period: `2025-08-10T00:00:00Z` through `2026-08-10T00:00:00Z`
- Initial capital: `JPY 10,000`
- Monthly contribution: `JPY 0`
- Compounding: enabled
- Required source coverage: V12, PENGU, Q102, V52, FET, HYPE, IDLE, RESIDUAL
- Replay mutations: orders `0`, cancels `0`, position changes `0`

## Fail-closed status

The report is not populated with performance numbers until every candidate and
market source carries the exact target runtime SHA and passes its SHA-256
manifest check. The available legacy ledger is from runtime
`dbf84542311c15f69508f91a0e7311ff7e686d96`; it is intentionally rejected by
the exact-source validator and must not be relabeled as current.

The runner returns:

`EXACT_BT_SOURCE_RUNTIME_SHA_MISMATCH:V12:dbf84542311c15f69508f91a0e7311ff7e686d96`

until the exact `e8cc2e73...` full-period source package is supplied.

## Reproduction

```text
node --test --test-isolation=none \
  tests/exact-current-sha-bt-contract.test.ts \
  tests/exact-current-sha-integrated-bt.test.ts \
  tests/exact-current-sha-monthly-report.test.ts

node scripts/research/run-exact-current-sha-monthly-bt.ts \
  <exact-current-sha-manifest.json> \
  docs/research/results/exact-current-sha-monthly-bt-20261014
```

Only a report whose manifest records the exact target SHA and whose
`reconciliation.status` is `PASS` is a valid monthly BT result.
