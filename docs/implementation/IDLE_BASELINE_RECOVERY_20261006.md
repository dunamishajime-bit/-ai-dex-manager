# Idle baseline recovery — 2026-10-06

The operator confirmed the unowned FET position was manually opened and closed.
Read-only venue reconciliation found no FET position or open order. The obsolete
FET_UNOWNED_LIVE_POSITION_PRESENT flag was backed up and cleared; no order was sent.
The pre-existing 24-hour FET cooldown remains intact.

Residual LONG admission previously returned its async entry promise without
awaiting it inside tick's account-lock try/finally. Baseline timestamp rejection
escaped the tick error handler and terminated the daemon; the lock also released
before admission/order processing completed. Child operations now settle before
tick releases the lock. Unavailable baseline evidence records a rejected decision
and returns held, retrying on later ticks without a sticky manual review.

Baseline timestamp/schema gates, strategy numerical rules, capacity, margin,
operator activation, kill-switch, and ownership checks are unchanged.
Historical parity certificates retain their scope; release lineage is advanced
for this operational fix, without claiming a new backtest.

Validation: three regression tests fail on the previous code and pass on the fix;
all 69 Idle SHORT/residual tests pass; TypeScript noEmit passes.
