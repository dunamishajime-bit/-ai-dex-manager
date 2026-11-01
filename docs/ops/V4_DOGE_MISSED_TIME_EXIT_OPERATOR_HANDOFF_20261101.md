# V4 DOGE missed TIME exit — operator handoff (2026-11-01)

## Incident identity

This handoff is only for the single durable V4 leg:

- Leg ID: `DOGEUSDT:REC_Y06_REV_D0_T72:SHORT:1793181600000`
- Route: `REC_Y06_REV_D0_T72`
- Side / size: DOGEUSDT SHORT 226
- Entry: 0.08052
- Planned TIME exit: 2026-10-31 19:00 JST
- Planned exit model price: 0.07505
- Durable STOP clientOrderId: `v12-v4-98ded39746ed3502a4d7b0e26ef9`
- V4 runtime SHA: `53a0be396719f0284af4e11b35c66a4ac7d58f79`

The V4 durable state still records the planned exit as `TIME`. The production V4 engine refuses to execute a planned exit more than 15 minutes late and therefore reports `V4_STALE_EXIT_REVIEW_REQUIRED`. That behavior is correct fail-closed behavior for a missed decision.

## What is already verified

The protected read-only preflight must pass immediately before any operator recovery. It checks:

1. V4 daemon is active on the exact runtime SHA.
2. The only open V4 durable leg is the DOGE leg above, qty 226.
3. The durable planned exit remains exactly TIME / 1793440800000 / 0.07505.
4. The durable protection remains STOP_CONFIRMED with the exact resident STOP ID and qty.
5. Shared Kill Switch is inactive.
6. Shared Daily Risk is complete and not tripped.
7. Margin Guard is HEALTHY and allows orders.
8. Pending exposure registry has no active reservations.
9. Signed Aster GET shows exactly DOGE SHORT 226 at entry 0.08052 with the exact reduce-only STOP still NEW.
10. The diagnostic itself sends zero orders, zero cancels and zero position changes.

## Required recovery behavior

The operator recovery must use the existing V4 one-shot operator-exit hook in `V4RunnerEngine`. It must remain hard-scoped to this exact leg and must not grant entry authority.

Required sequence:

1. Run the read-only preflight Action and require PASS.
2. Stop the normal V4 daemon so the normal stale-exit tick cannot race the one-shot recovery.
3. Re-run the same signed Aster read-only proof while the resident STOP remains active.
4. Invoke a one-shot V4 operator-exit command scoped only to the exact DOGE leg, qty 226, SHORT, with the exact TIME planned-exit tuple above.
5. Require the V4 durable dispatcher to create the normal EXIT intent and reconcile the actual venue fill. Do not use a synthetic/test order.
6. Require the durable leg to become CLOSED and qty 0, with an EXIT_FILL journal event.
7. Only after the position is proven flat should the normal V4 protection lifecycle retire/cancel the resident STOP. Do not cancel the STOP first.
8. Verify signed Aster GET shows no DOGE position and no resident STOP.
9. Restart the normal V4 daemon on the exact SHA and require stable active state plus a heartbeat that no longer contains `V4_STALE_EXIT_REVIEW_REQUIRED`.
10. Verify Shared Risk / Margin Guard / pending exposure are still healthy.

## Fail-closed rules

Abort and do not submit another exit if any of these change before recovery: leg set, qty, entry, planned exit tuple, STOP ID/status, operator activation, runtime SHA, Kill Switch, Daily Risk, Margin Guard, pending exposure, or signed venue position.

If the one-shot command returns an unknown/ambiguous execution state, restart the same durable V4 runtime and reconcile the original client/order intent. Never send a second reduction simply because the first response was uncertain.

No strategy edit, new exposure, risk-limit change, test order, unrelated cancel, or unrelated position change belongs to this incident recovery.
