# V12_X1.00_ALL implementation report

This branch adds the frozen, 1x / 24-hour V12 contract next to the existing
PENGU Dual LS V2 and V52 stock sleeves. It is an offline implementation only.

## Safety boundary

- Default V12 mode: `SHADOW`, `enabled=false`.
- The runner is plan-only and has no venue order adapter; a `LIVE` request is
  explicitly returned as `live-blocked`.
- PENGU V2 and V52 share the account-scoped lock file and the shared crypto
  daily-risk state in LIVE mode. Missing, stale, malformed or mismatched risk
  state blocks new crypto entries.
- Unknown Aster symbols fail closed; the complete frozen V12 universe and
  `PENGUUSDT` are classified generically rather than through a short allowlist.
- V12 resident STOP_MARKET/TP installation is idempotent. A failed or
  unacknowledged protection install triggers reduce-only flatten and manual
  review. Stop replacements are acknowledged before the previous stop is
  canceled.
- V52 crypto gross accounting now covers the complete V12 universe plus
  PENGU; unknown non-flat Aster symbols fail closed for manual review.
- Expired account-lock ownership is never deleted automatically because an
  exchange order may still be pending; it remains blocked until reconciliation.

## Frozen lineage

`V12_X1.00_ALL` uses frozen source SHA
`27f023a37d08b71c6e59b797fdc03c20d6032da2`. Parameters are declared in
`config/v12X1AllRuntime.ts`; no research result was used to retune them.

## Verification

The offline CI workflow runs application/PENGU typechecks, TypeScript and
Python lock/risk self-tests, V12 signal/sizing and runner tests, resident-stop
failure handling, and Python compilation. No VPS, LIVE flag, kill switch or
order API is touched by these checks.

`VPS_UNCHANGED=true`
`LIVE_NOT_ACTIVATED=true`
`ORDERS_SENT=0`

## Deliberate production divergence

The V12 runner in this implementation is plan-only and has no Aster order
adapter. It can produce SHADOW/PAPER signals and durable state/reservations,
but a LIVE request returns `live-blocked`. Adding a venue adapter, activating
systemd, or changing the kill switch requires a separate explicit request.
