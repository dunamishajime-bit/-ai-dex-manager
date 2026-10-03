# Current model scope gaps — no Production certification

The user approved an explicitly labeled conservative causal model, not
fabricated historical exchange/account evidence. That approval does not permit
changing sizing, removing retained strategies or certifying a different scope.

## Fee headroom and fixed allocation

The optional post-fee guard previously protected total gross / 5x BASE margin
reserve but not the crypto sleeve. An isolated regression reproduced 3.00300225x
after entry fees against the 3.0x sleeve cap. The final admission guard now
checks strategy, sleeve and total post-fee headroom after any preemption.

Idle SHORT and residual LONG require fixed 1.0x in their actual runners. Both
normalize equity / quote and HOLD if normalized notional / equity is below
1 - 1e-6. Their durable allocation and reservation gross are exactly 1.
Reducing an accepted allocation silently in the model would not match this
contract. The first guarded run rejected every Overlay by applying post-fee
equity shrinkage to the strategy allocation ceiling. A stronger regression
then required a flat 1x intent to be admitted when crypto3x/total4.25x have
sufficient room. The corrected model keeps strategy allocation room in its
original intent units and guards sleeve/total marked exposure after fees.
It still rejects a fixed intent when the portfolio cannot fit the whole 1x.
This correction changes no nominal strategy or portfolio cap. Full model /
runtime scope certification still requires the evidence described below.

Source locations: lib/idle-priority-short-runner.ts enter; lib/idle-residual-long-runner.ts enter;
scripts/research/formal_core_live_ownership.py optional postfee_margin_guard.

## PENGU candidate scope is historical

The pinned gated candidate file is SHA256
ecc8103dea9ce392ea72fe918ca362416b762f0072a1a43d7f0d496b6755b935.
It contains 113 PENGU lifecycle candidates with requested gross values:
0.1875, 0.5, 0.9401141853315763, 0.9522340150142363,
0.9567804441794603, 0.9806217381438617, 1.0, 1.25.
The recorded source runtime includes dbf84542311c15f69508f91a0e7311ff7e686d96.
These are not evidence of the current COMBINED_FILTERED_Q60_DD17_H72
fixed-entry-1.0x contract. Regenerate from the actual signal functions and
market inputs; update quarantine/DD only from integrated accepted fills and
closes. Do not normalize this historical tape blindly or edit its SHA anchor.

## Enabled HYPE scope

VPS read-only on 2026-10-04 found HYPE's current 53eeff54 release state held in
HYPE_ZEC_RUNNER_FAIL_CLOSED:ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT.
The existing five-Core-plus-Idle/residual model contains no HYPE strategy.
A certificate covering an enabled HYPE runner needs a separately verified
causal HYPE path in the integrated scope; do not silently disable it.

## HYPE patch safety boundary

The patch defers only the shared classifier's known local pre-request budget
errors before any possible entry/exit/protection path, with no durable owned
position, pending order or existing review. It saves a rejected heartbeat and
returns HOLD; reconciliation is deferred, not declared successful. Errors
after the read-only phase and unknown errors remain manual review.
An old manual review is never automatically cleared by this patch. Recovery
still requires an exact backup, fresh authenticated ownership/order/pending
evidence and the dedicated approved recovery procedure.

No Production/current/operator/state/positions/orders are changed by these
research and runner-source tests. CI success alone does not remove these gaps.
