# V52 Idle owner recovery contract (2026-10-16)

The V52 `HOLD_PROTECTED` state caused by the 2026-10-15 false-positive DOT
ownership failure is recoverable only through
`scripts/disdex-v52-idle-owner-recovery.ts`.

The helper is a root-operated, one-shot, fail-closed boundary. It never sends
an order, cancels an order, changes a position, or edits the Idle position
state. Before clearing the shared hold it requires:

- exact release SHA and Idle state SHA;
- no pending or manual-review state;
- fresh Shared Risk and HEALTHY Margin Guard;
- all trading runners stopped for the cutover window;
- three consecutive signed Aster `positionRisk` and `openOrders` reads;
- exact DOT/JUP (or the state-declared Idle symbols) short-position ownership;
- 5x Cross venue readback;
- exactly two `NEW`, `BUY`, `reduceOnly` STOP/TP orders per owned position;
- deterministic client-order IDs, quantities, and trigger prices;
- no unmanaged position or open order.

`--verify-only` produces evidence without mutation. `--apply` additionally
archives the Kill Switch and Idle state, then clears only the shared
`HOLD_PROTECTED` created by the allowlisted V52 unknown-non-flat-symbol error.
Any post-write venue mismatch restores a protected hold and exits fail-closed.

The existing common/runtime release and the independent V12 V4 release remain
separate SHA domains. This helper does not authorize or change the V4 artifact.
