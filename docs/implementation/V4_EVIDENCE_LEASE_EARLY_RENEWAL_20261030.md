# V4 Evidence Refresh Lease: Pre-expiry Renewal

Status: SOURCE_ONLY_NOT_DEPLOYED. No order authority, VPS changes, owner token,
or refresh grant was created by this change.

## Issue
The earlier implementation refused to replace an active lease, so even a
correctly signed fresh owner approval could not renew it until after the
24-hour lease had already expired.

## Revised bounded rule
- A lease lasts at most 24 hours, still pinned to the same exact immutable
  release SHA, V4_EVIDENCE_REFRESH_ONLY, V12_V4, canonical plan hash,
  deployment target and ordersEnabled=false.
- Replacement is permitted only in its final 12 hours, or after expiry.
- Every replacement requires a new independently owner-signed short-lived
  token and fresh single-use nonce. The nonce-store verifier is authoritative.
- The updater does not sign anything, generate owner tokens, reset approvals,
  extend the 24-hour TTL, or enable trading.
- Before the 12-hour window replacement is rejected as too early.
- Missing, expired or invalid approval leaves the lease/evidence unchanged;
  expired dynamic evidence leaves new order permission blocked.
- The 30-minute timer cannot renew a lease by itself.

## Production boundaries
- This is source and tests only; it does not deploy or restart V4.
- The unified root executor currently implements SHARED_CRYPTO_RISK_ONLY,
  not V12_V4 no-order cutover. LIVE_EXECUTOR_CONTRACT_CERTIFIED is insufficient
  to authorize V4 migration.
- The V4 trading-capable service must NOT be started on a refresh-only
  ordersEnabled=false grant. It has its own real-order activation gate.
- Any new immutable SHA requires fresh SHA-bound release/static evidence and
  independent dynamic venue/risk evidence; old SHA evidence cannot be renamed.
- The trading service SHA transition needs an independently certified scoped
  executor, signed owner grant, STOP continuity and 3-cycle audit.
- Until then preserve existing runner, position, STOP, Kill Switch, peer SHA
  map and current symlink. Deny new entries on any unresolved gate.

## Test command
python -m unittest tests.test_disdex_v4_refresh_activation -v

Tests: too-early rejection, boundary acceptance, expired replacement
eligibility, no extension without a new grant, nonce-reuse rejection,
scope/plan/SHA, ordersEnabled=false validation.
