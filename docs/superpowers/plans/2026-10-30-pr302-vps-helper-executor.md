# PR #302 VPS helper executor implementation plan

> **For the implementer:** execute this plan inline with
> `superpowers:executing-plans`. Use `superpowers:test-driven-development`
> for every production behavior and `superpowers:verification-before-completion`
> before any completion claim.

## Goal

Complete the route-neutral deployment contract from PR #302 with a root-only,
fail-closed executor that can be used by either the GitHub Actions adapter or
the Codex fixed SSH adapter. The first production scope is
`SHARED_CRYPTO_RISK_ONLY` with `ordersEnabled=false`; no other runner, current
symlink, position, STOP, Gross, Kill Switch, or order permission may change.

## Constraints

- The existing live release and all existing protection remain unchanged until
  a genuine owner-signed grant, root-owned activation artifact, fresh venue
  evidence, exact plan, and rollback evidence are present.
- The executor must never create an approval artifact, private key, password,
  venue proof, or token. It only verifies artifacts supplied by the owner/root
  operator.
- No test order, cancel, position change, STOP replacement, Kill Switch
  operation, or dynamic Gross allocation is permitted.
- Existing multi-SHA runner pins remain the source of truth. `current` is not
  used as a fallback for peer SHAs.

## Architecture

1. Keep the existing read-only preflight path and add an explicit `--execute`
   path that requires root, an exact signed grant, a root-owned scoped
   activation artifact, a nonce directory, a current-plan reconstruction, a
   root-owned runner-pin manifest, immutable release markers, and fresh
   read-only venue evidence.
2. Use a small injected systemd/state adapter so unit tests exercise real
   executor decisions without invoking systemd or a venue. The production
   adapter uses argument arrays only and permits only the exact service units
   in the approved scope.
3. For Shared Risk-only, atomically publish the runner-pin manifest, stop and
   mask only the old Shared Risk unit, start only the exact new unit, and
   restore the old unit and manifest on any failed postcondition. Never change
   `/home/deploy/disdex-trading/current`.
4. Make nonce consumption occur only after all read-only checks pass and just
   before the mutation transaction. A replay or any mismatch fails closed.
5. Verify post-cutover state with three read-only audit cycles. The executor
   returns a machine-readable receipt with zero order/cancel/position effects;
   LIVE status is not inferred from source or CI.

## Tasks

### Task 1 — RED contract tests

Add focused tests for root-only execution, activation artifact metadata and
scope binding, signed-token nonce replay, venue evidence freshness/effects,
Shared Risk-only service isolation, current symlink preservation, rollback on
start failure, and three-cycle audit requirements. Run them before adding
production executor code and record the expected failures.

### Task 2 — GREEN executor and fixed wrapper

Implement the smallest executor that satisfies Task 1. Keep the existing
preflight API compatible. Add explicit apply/audit helpers, root-owned file
checks, exact service allowlists, atomic manifest publication, mutual
exclusion, rollback, and fail-closed receipts. Keep the wrapper as the only
root entry point and make the forced-command dispatcher accept no arbitrary
shell or apply flags outside the fixed contract.

### Task 3 — Scope matrix and adapter integration

Extend contract validation and tests for all requested scopes. Keep the
scope matrix and both adapters route-neutral, but implement mutation only for
the first certified `SHARED_CRYPTO_RISK_ONLY` transaction. Margin Guard,
monitor, HP, individual runner, full-project, and rollback scopes must remain
explicitly fail-closed until each has its own transaction, rollback, and
three-cycle audit implementation. Individual runner scopes may not modify
peers. Update both Actions and Codex adapters to invoke the same
execute/preflight boundary and add source-contract checks for secret and
command safety.

### Task 4 — VPS staging/read-only certification

Run unit, integration, fail-closed, rollback, and static tests. Push the
source branch and inspect PR #302 CI. On the VPS, install or stage only the
root-owned helper after source verification, without activating a release or
changing systemd/positions/STOPs. Run a read-only preflight and capture
metadata hashes; do not create or copy an activation artifact.

### Task 5 — Final review and handoff

Perform a fresh whole-branch review, run the full relevant test commands, and
report source/CI/staging separately from LIVE. The only remaining blockers
may be genuine owner approval, protected Environment configuration, fresh
venue evidence, or a formally authorized VPS cutover; never claim
`LIVE_VERIFIED` without three post-cutover audits.

## Expected verification

- Focused Python executor tests: all pass after RED→GREEN.
- Existing owner approval, deployment plan, Codex adapter, and root-gate
  tests remain green.
- Node root wiring/pin/rollback contracts remain green.
- `git diff --check` is clean.
- GitHub Actions PR checks for the pushed head are observed directly.
- VPS read-only command output shows no order/cancel/position mutation and
  existing live state remains unchanged.
