# V4 and All-Runner Runtime Reconciliation Specification

## Scope

Stabilize the V12 V4 runner, unify all production runner and safety-daemon
runtime references to one immutable release, and then carry the FET
`VOL10_RET15` gate into that same release. Do not change trading signals,
allocation, or risk limits except for the already approved FET entry filter.

## Observed production facts

- Current symlink is `ce1edeead8d0f9e5d88e829d415057117502a335`.
- V4 is running from `f44cbc1905768bddd8e8a18fcfbece2d58fccb74` and repeatedly
  fails closed.
- V4 failures include FET peer SHA mismatch and an EACCES read of the FET
  state path.
- FET is temporarily running from `acedffdad52bc6a4b7bb5992122be2ef6b9a2cda`
  with the approved `VOL10_RET15` filter.
- Q102 and several safety snapshot/watchdog units are not healthy, so the
  global health state is correctly fail-closed.
- The last Aster read-only audit observed no positions, no open orders, and
  zero order/cancel/position mutations.

## Required invariants

- Every active trading runner and safety daemon uses the same release SHA.
- V4 peer attestation resolves FET, PENGU, Q102, V52, HYPE, Idle/Residual,
  Shared Risk, and Margin Guard from the same generated runtime contract.
- FET state is owned by `deploy:deploy`, mode `0600`, with a `0700`
  `deploy:deploy` parent directory before any runner reads it.
- A runtime or state mismatch fails closed before order mutation.
- No test, synthetic, manual, or forced market order is sent.
- Existing positions and protective orders are preserved and reconciled before
  cutover.
- The FET `VOL10_RET15` gate is the only strategy behavior change in this
  release.
