# HYPE / ZEC Long Sidecar Contract

## Scope

This document defines the production-safe integration boundary for the
HYPEUSDT and ZECUSDT long-only research sidecars. It does not activate live
execution. The default runtime mode is `SHADOW`, with all live and operator
flags disabled.

## Fixed strategy contract

| Sleeve | Direction | Risk at protective stop | Maximum gross | Venue |
| --- | --- | ---: | ---: | --- |
| `HYPE_LONG` | Long only | 5.0% of account equity | 1.0x | 5x Cross |
| `ZEC_LONG` | Long only | 4.5% of account equity | 1.0x | 5x Cross |

Risk-derived quantity is capped by both the stop-loss risk budget and the
gross ceiling. The implementation never rounds quantity upward to satisfy
`minQty` or `minNotional`; an insufficient quantity is a capacity/no-order
decision.

The venue leverage is a margin-efficiency setting only. It does not multiply
strategy notional or risk.

## Priority and capacity

HYPE/ZEC are the lowest-priority sidecars. V12, PENGU, Q102, FET, and V52
may request capacity recovery only after their own accepted candidate and
shared account lock have been verified.

Preemption is authorized only when all of the following are true:

1. `existing + pending + reserved + candidate worst-case` exceeds the
   applicable crypto or total normal cap.
2. Removing the HYPE/ZEC sidecars makes that same candidate fit both caps;
   otherwise the request is fail-closed.
3. The sidecar venue state is read back as exactly 5x Cross and the account
   lock is valid.
4. Each sidecar can be reduced by at most 50% of its current quantity, and
   the planned reduction is no larger than the measured deficit.
5. The reduce-only fill and quantity are read back successfully.
6. Replacement reduce-only STOP/TP protections are installed and read back
   before the previous protections are cancelled.
7. A fresh portfolio plan passes after the reduction and before the higher
   priority exposure order is submitted.

Partial fills, unknown fills, stale quotes, protection read-back failures,
lock uncertainty, or any other reconciliation ambiguity remain in manual
review/fail-closed state. A sidecar never preempts another sidecar.

## Runtime gates

The sidecar runner requires all of these for live execution:

* `DISDEX_HYPE_ZEC_MODE=LIVE`
* `DISDEX_HYPE_ZEC_ENABLED=true`
* `DISDEX_HYPE_ZEC_LIVE_EXECUTION_ENABLED=true`
* `DISDEX_HYPE_ZEC_PRODUCTION_CONFIG_LIVE_ENABLED=true`
* `DISDEX_HYPE_ZEC_OPERATOR_ARMED=true`
* an exact 40-character runtime SHA

The preemption path separately requires
`DISDEX_HYPE_ZEC_PREEMPTION_ENABLED=true`. Runtime wiring intentionally emits
all of these as disabled/shadow values until a separate operator activation
process is completed.

## State and ownership

Sidecar state is stored under
`/var/lib/disdex/hype-zec-long/`, is a regular file, is not a symlink, is
owned by the runtime account, and is validated against the exact runtime SHA.
Pending exposure is registered before a live entry and cleared only after
venue reconciliation. Existing HYPE/ZEC positions are classified as reserved
sidecars for reconciliation; they are not reassigned to another strategy.

## Verification boundary

The implementation is covered by policy, signal, protection, state, runner
gate, preemption planner/executor, pending exposure, and existing V12/PENGU/
Q102/Shared Risk/V52 regression tests. No VPS deployment, operator activation,
market order, cancel, or position mutation is part of this change.
