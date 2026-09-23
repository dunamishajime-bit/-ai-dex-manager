# Q102 / V52 Rate-Budget Recovery and Cross-Runner Resilience

## Goal

Safely recover the Q102 runner blocked by an unresolved AVAXUSDT `planned` entry and restore V52 only after its stale-Q102 fail-closed condition is resolved. Prevent the same Aster global rate-budget coordination error from causing inconsistent runner failures across V12, PENGU, Q102, V52, and FET.

## Production evidence at design time

Read-only VPS inspection on 2026-09-24 observed current release `43a604e3940d4f3b4229ef586a178dd1fa258768` with a matching release marker. PENGU, V52, Shared Risk, and Margin Guard were active; Q102 was inactive. Q102 state had no position and a `planned` AVAXUSDT BUY pending record. The shared Kill Switch was active with reason `V52 recoverable tick error: ASTER_GLOBAL_RATE_BUDGET_SATURATED:5005`. V52's daily latch was fail-closed with reason `V52 PnL API failure: QUALITY102_STATE_STALE`.

Earlier read-only Aster checks found no positions or open orders, an order lookup returning Aster `-2013` for the pending client order, and no matching AVAX trades. These are incident clues, not sufficient by themselves to mutate state; the recovery command must repeat and enforce its full evidence gate.

## Invariants and non-goals

- Do not change strategy signal, selection, priority, sizing, gross limits, or exit rules.
- Do not bypass operator activation, Global Kill Switch, Shared Risk, Margin Guard, account-order lock, or any fail-closed preflight.
- Never synthesize, test, force, cancel, flatten, or duplicate an order for validation.
- Do not hand-edit state or Kill Switch JSON. State transitions use the existing state store or an audited official recovery interface, preserve every field accepted by the current schema, and reject unknown/malformed fields without writing.
- A budget coordination failure must never be reported as an Aster HTTP/API response because no venue request was sent.
- Keep unknown, malformed, stale, credential, HTTP 429/418, connection, and execution-state errors distinct; they retain their existing fail-closed behavior.

## Architecture

### 1. Q102 pending-entry recovery

Add a dedicated one-shot reconciliation path for a stale Q102 pending entry. It runs under the shared account-order lock and is read-only until all checks pass. It validates the state schema, exact pending identity, runtime SHA lineage, file ownership/mode, and that the pending has exceeded the configured order-reconciliation horizon.

The path requires three consecutive authenticated read-only reconciliation rounds. Every round must show: no matching open order; order lookup conclusively `-2013`/not found (transport or ambiguous errors fail closed); no matching user trade since shortly before pending creation; no matching Aster position; and no unmanaged account position/order. The pending record must remain byte/identity-equivalent across rounds. A changed state or any inconsistent evidence aborts without writing.

After evidence is complete, create a timestamped backup, then use the Q102 state store to mark this exact pending attempt terminal-without-exposure while preserving every other field accepted by the current schema and the audit history. Do not reset the state or silently discard the idempotency/client-order identifiers. Keep the source runtime SHA unchanged during this recovery write. Then use the existing formal migration helper, with its own backup, to migrate the reconciled flat state to the candidate release SHA and run candidate self-check/preflight. Unknown fields fail closed before any write. Orders, cancels, and position changes remain zero.

### 2. Common rate-budget coordination contract

Define a shared error classifier and equivalent adapters for TypeScript and Python consumers used by V12, PENGU, Q102, V52, and FET. Only failures proven to occur before an Aster HTTP request—valid `ASTER_GLOBAL_RATE_BUDGET_SATURATED:<integer-ms>` and explicitly enumerated budget-lock coordination failures—are classified as `RATE_BUDGET_DEFERRED`. Malformed budget state/configuration and all venue/network errors are not in this class.

All runners apply the same behavior:

1. Fail closed for any new exposure in the affected tick; do not send an order.
2. Preserve existing venue-side protective orders and do not cancel, flatten, or alter positions because of the local scheduler error.
3. Defer with bounded backoff and jitter; do not tight-loop or translate this single local queue miss into a sticky shared Kill Switch.
4. Prioritize reduce-only/protective work, then reconciliation and risk/account reads, before new-entry work in the shared Aster budget scheduler.
5. If a safety-critical/protection or reconciliation request itself cannot obtain a slot by its deadline, activate the existing fail-closed hold and require verified recovery; never claim protection/readiness from stale data.
6. Emit structured per-runner telemetry with error class, queue wait, priority, deferred decision, and explicit zero mutation counters. Do not log credentials or signed request material.

HTTP 429/418 cooldowns remain governed by the existing venue rate-limit path and are not downgraded to local queue deferrals.

### 3. Restart-loop containment

Keep Q102's pending-order preflight fail-closed. Correct the systemd start-limit configuration so `RestartSec` cannot exceed/reset outside the start-limit window: use a finite restart delay and an effective burst/window for Q102 and the other affected trading runner templates. A deterministic preflight/state failure must reach the start limit and remain stopped pending operator/reconciliation action; it must not retry indefinitely. Successful intentional starts and normal runner behavior remain unchanged.

### 4. Exact-cause shared Kill Switch recovery

Extend an official, audited recovery path rather than editing the shared Kill Switch file. It may clear only the exact recoverable V52 reason attributable to the local rate-budget saturation under this incident. Preconditions: Q102 pending recovery and preflight pass; all participating state is current, SHA-consistent, owned, and reconciled; three consecutive authenticated Aster reads show the required flat/no-unmanaged-order condition; shared rate-budget state is valid and no longer saturated; Shared Risk is fresh/complete; Margin Guard is HEALTHY; and no other Kill Switch cause or manual-review condition exists.

Back up the original latch and record an audit receipt. Any reason mismatch, additional cause, non-flat/unowned state, read error, stale data, or failed safety service leaves the latch untouched and all new exposure blocked. Recovery does not create or rewrite the operator activation artifact. If the exact-SHA operator gate is not valid, runners remain blocked from real-money entry even after system health is restored.

### 5. V52 and runner restoration sequence

After the Q102 state is fresh and reconciled, verify that V52's `QUALITY102_STATE_STALE` daily fail-closed latch follows its existing recovery contract and clears only from fresh valid Q102 data; do not edit the latch directly. Validate Shared Risk and Margin Guard, then bring Q102 and V52 through their normal systemd gates in a controlled sequence. Apply the common rate-budget behavior to all affected runner releases before starting them. Preserve existing operator activation requirements and do not start an old/new SHA pair simultaneously.

## Testing strategy

Use TDD. First add failing tests, observe the expected failures, then implement the smallest change. Tests must cover:

- Q102 pending recovery accepts only the exact planned/no-fill/no-position/no-open-order case after three stable read-only rounds; any ambiguity, state race, trade, position, or unrelated order rejects with zero writes.
- Recovery backup and state-store transition preserve all schema-recognized fields, history, and identifiers; unknown fields reject without mutation; state owner/mode and SHA contract remain enforced.
- The same canonical rate-budget errors produce the same deferred/fail-closed decision in V12, PENGU, Q102, V52, and FET; orders/cancels/position changes are zero.
- New-exposure work is denied during deferral; protective/reduce-only and reconciliation work is prioritized; safety-critical deadline failure holds the system closed.
- HTTP 429/418, malformed lock/state, connection reset, and unknown errors are not misclassified as local saturation.
- Q102 systemd restart limits become effective for repeated preflight failure and do not weaken the preflight.
- Kill Switch recovery accepts only the exact eligible reason and complete evidence set; mismatch or stale/missing evidence leaves it active.
- V52 latch clears only through its existing fresh-data behavior; it remains closed when Q102 is stale.
- Existing PENGU, V12, Q102, V52, FET, Shared Risk, Margin Guard, watchdog, and recovery regression suites pass with all synthetic/test/real order counters zero.

## Rollout and verification

1. Implement and run focused RED/GREEN tests, then the full affected regression suite, typecheck, and production build.
2. Commit and push the implementation branch; verify remote SHA and a real green GitHub Actions run (not a zero-job result).
3. Stage the exact remote commit as an immutable VPS release; do not mutate the current release in place.
4. Before any recovery write, repeat authenticated Aster/VPS read-only preflight and record balances, positions, open orders, protective orders, state identities, Kill Switch, Shared Risk, and Margin Guard.
5. Run Q102 one-shot recovery only if every specified evidence gate passes. Then verify state and Q102 preflight before proceeding.
6. Run the exact-cause Kill Switch recovery only if all gates pass. Restore services one at a time and verify SHA, service state, heartbeat, safety state, and no mutation after each.
7. If operator activation is absent/mismatched, stop before enabling real-money trading. Never bypass it to satisfy service-active checks.
8. Finish with authenticated read-only reconciliation and report exact remaining blockers; do not label recovery complete based on tests or systemd state alone.
