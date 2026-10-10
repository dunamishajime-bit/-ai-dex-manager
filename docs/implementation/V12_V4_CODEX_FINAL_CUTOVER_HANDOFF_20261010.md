# V12 V4 — Codex final cutover handoff readiness (2026-10-10)

**STATUS: BLOCKED_INDEPENDENT_SOURCE_PARITY_AND_MULTI_LEG_EXIT_CERTIFICATION.**
This file does **not** authorize LIVE activation or an order. The implementer
must not relabel a passing TypeScript/CI test as broker certification.

## Immutable anchors

- GitHub: `dunamishajime-bit/-ai-dex-manager`
- Source branch: `codex/v12-v4-production-cert-20261009`
- Adopted research policy: `V2_M150_D05_CORE_NATIVE`, 41 frozen routes
- 41 route kinds: **37 TIME, 3 ATR, 1 NATIVE**
- Caps: V12 3.0x, Crypto 3.5x, Total 4.75x, Recovery 2.5x
- Approved max DD: **21%**, not an operator LIVE token
- Last verified existing production: `ce1edeead8d0f9e5d88e829d415057117502a335`
- Research original 10bps: JPY291,326,102.6203428, DD -20.420013795%.
- 10bps emergency 8%-of-entry-fill sensitivity: JPY282,646,704, DD -19.526%.
- 20bps emergency 8% sensitivity: JPY228,069,633, DD -19.974%.
- External period PF remains weak and must be disclosed in the certification.

## Production code prepared, NOT active

- `scripts/v12-v4-production-runner.ts`: long-running read/decision +
  signed account ownership and durable entry/exit reconciliation.
- `lib/v12-v4-runner-engine.ts`: global account lease, 8-family ownership,
  exact journal, venue STOP normalization and STOP readback.
- `lib/v12-v4-resident-stop-owners.ts`: separate identity+remaining quantity
  validation for every same-symbol virtual V4 leg; never rely on one symbol STOP.
- `lib/v12-v4-production-lifecycle.ts`: Native exit evidence now keyed to
  the actual route from the frozen catalog, not a misidentified Core route.
- `lib/v12-v4-certified-gates.ts`: ENTRY requires independently reviewed,
  current, exact-release-SHA, root-managed 41-route certificate. A signed,
  existing V4 leg may still receive reduce-only protection/EXIT on expiry.
- `lib/v12-v4-time-stop-approval.ts`: 8%-of-actual-signed-fill research
  candidate for all 37 TIME routes, but **not yet operator-approved**.

The original research accepted ledger has 828 V12 trades spanning **all 41**
route names: 746 TIME, 44 ATR, 38 NATIVE. All 746 TIME scheduled exit
horizons match the frozen TIME duration (0 mismatches). Historical route
coverage is **not** proof of exact live entry/exit source parity.
Original historical replay has **261 pairs of overlapping V12 same-symbol
virtual legs**; prohibiting a second leg would change the authorized BT.
Per-leg STOP identity/quantity is verified in mock tests, but an atomic
individual STOP-cancel/partial-exit/rearm sequence with remaining same-symbol
legs is **not certified**, and the runner now supports independent same-symbol STOP/EXIT readback and
  crash-safe retirement for a fully closed leg with signed remaining exposure.
  Partial-close/racing triggers still require independent Aster certification.

## Hard blockers that cannot be declared PASS by this code

1. Independent signed H1/H2 source, feature, route priority and Entry parity
   against all 41 research routes, including the H2 Native regime and its
   true next-open exit evidence. Never invent external proof.
2. Verified Aster protective STOP semantics, Partial Fill, tick-size/mark-price,
   signed actual executions, failover, restart and same-symbol multi-leg
   stop/close race. Tests are simulated, not actual-money proof.
3. Consistent all-eight runner state/quantity and shared pending Gross after
   final new-SHA rollout. RESIDUAL belongs inside IDLE, not an extra runner.
4. Final Kill Switch, Margin Guard, Shared Risk, watchdog, systemd release
   and rollback proof against an authenticated **fresh** Aster account.
5. The operator has not approved or installed an 8% TIME policy artifact,
   nor the separate 41-route production certification. Do not create fake
   PASS digests or disable checks to make orders work.
6. Out-of-period strategy underperformance is an acknowledged research
   adoption risk, not a repaired execution problem.

## Root-managed activation locations (no artifacts installed)

- `/etc/disdex/v12-v4-time-stop-approval.json`
- `/etc/disdex/v12-v4-production-certification.json`

Parent `/etc/disdex` is root-owned, non-deploy-writable on observed VPS.
Approval files must be root-owned, no symlinks, no group/other write; allow
deploy read-only access (e.g., root:deploy 0640). Both must attest the final
sha; production certificate expires after <=7 days. No blanket order
authorization from any research file or environment flag.

Root-side existing `disdex-live-operator-activation-gate.mjs` additionally
requires explicit `V12_V4` operator acknowledgement; it remains separate
from the seven existing legacy runner approvals.

## Final cutover-only Codex instructions, once proof is genuinely complete

Do not change any source code once the audited candidate SHA and 41-route
evidence have been certified. Rerun Linux CI for that exact SHA, confirm
uncommitted code is absent, calculate the SHA-256 of all independent proofs,
obtain legitimate operator acknowledgements and securely install the exact-SHA
certification. Check fresh Aster account/STOP/pending and old risk owners;
stage all runner releases coherently; prevent old V12 and new V4 dual entry;
install V4 service and test restart/failover; verify signed broker readback,
gross exposure, HP status and release marker. Preserve old release and
positions for immediate controlled rollback. Never place artificial TEST
orders. If a blocker remains, leave current LIVE as-is and report it by name.

## 2026-10-10 same-symbol exit recovery delta

The follow-on helper `lib/v12-v4-stop-retirement.ts` now identifies
un-cancelled resident STOPs belonging to **journal-closed** virtual legs.
It refuses cancellation unless the broker's signed net position equals
the exact surviving virtual V4 quantity; every surviving virtual leg has
its own correct reduce-only STOP quantity, side and identity; and the
retired STOP is still NEW and has never filled.

Within the account lease, the runner cancels only that retired CID,
refreshes signed venue positions/orders/balances and all peer/pending
sources, and rejects if the orphan remains. The normal EXIT path no
longer assumes only one virtual leg per symbol: after signed close it
checks the surviving aggregate venue quantity AND each remaining STOP.
This is mock-certified crash recovery; it is not an Aster failover
execution certificate, and partial fill/trigger races still fail closed.


## 2026-10-10 further runner crash-recovery improvements

- A retired STOP is now detected after the signed venue readback if its own
  virtual leg has already reached journal status CLOSED and quantity zero.
  The only cancelable order is the matching exact CID, active NEW with no
  executions. If other same-symbol V4 legs remain, each must still have
  its independent exact reduce-only STOP and the broker's signed net position
  must equal those surviving legs. After cancellation, the entire venue
  position/orders/balances + peer registry is re-fetched and checked.
  No manual deletion or fake broker evidence is allowed.
- Normal virtual-leg EXIT no longer has an artificial one-leg-per-symbol
  restriction. The actual signed reduce-only close is reconciled; the
  exiting leg's STOP is canceled; the remaining V4 signed net position and
  each other leg's STOP are verified before success.
- Aster's one-symbol signed USDT funding record is now allocated
  proportionately to same-side, overlapping V4 legs by their positive
  quantity as of the funding instant. Sum is preserved exactly, stable
  leg IDs give idempotent event keys, and mixed-side/foreign ownership remains
  rejected. Restart checkpoint behavior is unchanged.
- Source/41-route historical coverage and other mock suites continue to
  pass, but race-triggered partial STOP fills, broker cancellation semantics,
  long-offline funding attribution, and fully independent source parity still
  require Aster/forward evidence before operator LIVE certification.
