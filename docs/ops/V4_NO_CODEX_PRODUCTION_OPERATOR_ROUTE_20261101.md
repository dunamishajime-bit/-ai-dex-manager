# V4 no-Codex production operator route

## Goal

Make incident recovery independent of Codex as an operational dependency.

Canonical route:

1. ChatGPT / GitHub connector creates an exact incident request.
2. HP owner OTP approval binds operation, scope, exact runtime SHA, exact plan hash and order permission.
3. GitHub Action verifies the signed owner approval and current production invariants.
4. The Action reaches a **root-owned bounded executor already installed on the VPS**.
5. That executor uses the existing V4 one-shot operator hook.
6. Durable V4 order intent/fill reconciliation remains authoritative.
7. STOP retirement is allowed only after signed flat proof.
8. V4 restarts on the exact certified SHA and postflight verifies health.

Codex is not part of the production execution chain.

## Historical evidence

The NEAR incident used this pattern through PR #277:
- `lib/v12-v4-near-only-guard.mjs`
- `scripts/v12-v4-near-only-operator-exit.ts`

The dedicated operator command was the enabling component. Codex was only an implementation vehicle at that time, not a required runtime dependency.

The AAVE incident similarly used an exact incident-specific operator command rather than a generic trading CLI.

## Required permanent interface

A reusable production route should expose a root-owned executable with a narrow incident adapter interface. The workflow must not contain exchange credentials or generic symbol/side/quantity parameters.

The Action may provide only:
- approval request ID,
- immutable incident plan hash,
- exact runtime SHA,
- exact incident operation name.

The root-owned executor must derive and validate all trade identity from a preinstalled, reviewed incident adapter.

## Mandatory fail-closed contract

The executor must refuse execution unless all of these still match:
- exact V4 runtime SHA,
- exact durable leg ID,
- exact symbol, route, side and quantity,
- exact planned-exit tuple,
- exact resident STOP ID/status/quantity,
- signed venue position,
- Shared Kill Switch,
- Shared Daily Risk,
- Margin Guard,
- pending exposure registry,
- account lock / lease,
- owner approval identity and expiry.

The executor must grant no entry authority.

## Execution lifecycle

1. Redeem the exact owner approval for the same Action run.
2. Stop/quiesce only the V4 daemon.
3. Re-run signed read-only preflight with the resident STOP still active.
4. Acquire the shared account order lease.
5. Run the bounded one-shot V4 operator exit.
6. Reconcile the original durable EXIT intent and actual venue fill.
7. Require durable leg CLOSED, qty 0, EXIT_FILL.
8. Signed venue readback must prove flat.
9. Only then retire/cancel the resident STOP.
10. Signed venue readback must prove no position and no resident STOP.
11. Restart the exact V4 SHA.
12. Require heartbeat healthy and stale-exit review cleared.
13. Verify Shared Risk / Margin Guard / pending exposure remain healthy.

## Ambiguous-result rule

If an execution response is unknown or ambiguous, never submit a second reduction. Reconcile the already-created durable client/order intent and venue state first.

## DOGE incident status

The current DOGE incident already has:
- dedicated approval operation,
- immutable incident plan,
- HP approval request Action,
- owner OTP approval,
- read-only preflight,
- operator handoff readiness,
- exact V4 one-shot hook proof.

The only missing production component is a DOGE-specific bounded incident adapter/executor equivalent to the historical NEAR-only implementation.

## Safety boundary

The production route must never:
- expose a generic arbitrary trade endpoint,
- accept arbitrary symbol/side/quantity from a GitHub workflow input,
- cancel the resident STOP before flat proof,
- submit test orders,
- change risk limits,
- change unrelated positions/orders,
- retry a reduction merely because the first response was uncertain.

This document defines the permanent no-Codex route. Once a reviewed exact-scope executor exists on the VPS, future incidents use the approval/Action route directly without Codex.
