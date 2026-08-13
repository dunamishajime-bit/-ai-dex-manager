Exit code: 0
Wall time: 0.3 seconds
Output:
# SOL/LINK Priority + ETH/BNB/AVAX Shadow Router - one-year offline BT

This is a research-only comparison. It does not change production code,
execution settings, VPS state, approvals, accounts, positions, orders, or
Open Orders.

## Frozen Champion mapping

| Symbol | Driver |
| --- | --- |
| SOL | SOL_PROFIT_LOCK_REVALIDATE |
| LINK | LINK_V2_STAGED_HANDOFF |
| ETH | V109 primary only |
| BNB | BNB_SPONSOR_ROTATION shadow candidate |
| AVAX | V109 primary only |

BTC is loaded only because the frozen feature code can use it as a reference.
It has no candidate stream, position, order, PnL, or allocation.

## Router contract

- Two independently compounding sleeves, initially 50% + 50%.
- SOL and LINK are processed before complements.
- ETH, BNB, and AVAX are always shadow-tracked, even when not adopted.
- A priority entry may preempt a complement at that event's next-hour execution
  price; the exit is labeled PREEMPTED_BY_SOL or PREEMPTED_BY_LINK.
- No reverse/re-entry or Champion entry/exit changes are introduced.
- SHADOW_YTD_RANK uses only completed shadow trades available at the decision
  timestamp. A minimum of three completed trades is required before cumulative
  return/PF affects ranking; otherwise signal strength is the tie-break.
- SIGNAL_STRENGTH_ONLY never reads shadow history.
- Hourly mark-to-market equity is used for drawdown.
- Normal research cost is the frozen 10 bps round trip and execution delay is
  zero, matching the repository's prior comparison drivers.

The workflow asserts the frozen Champion source hashes before running.

