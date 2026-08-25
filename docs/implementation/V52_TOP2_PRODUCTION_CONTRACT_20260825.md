# V52 Top2 Production contract

This implementation is based on the official Production lineage
`ef91f81e86f819ba1e37ff9325e8972489e1544f`. Research PR #193 is not merged
directly.

## Frozen Production policy

- V12 X1.00 ALL, PENGU Dual LS V2 and V11 are unchanged.
- V50 uses the frozen signal snapshot and the existing qualified-candidate
  basis ranking.
- Rank 1 requests `1.00x` gross. Rank 2 is an additional P2 slot requesting
  exactly `0.50x` gross.
- At most two V50 slots are active and at most three V50 entry attempts are
  recorded per New York day.
- V52 stock gross is capped at `1.50x`; global gross is capped at `2.50x`.
- Rank 2 is rejected with `INSUFFICIENT_AVAILABLE_GROSS` when the atomic
  available budget is below `0.50x`; it is never partially allocated.

Immediately before reservation, the V52 runner computes current open gross,
active durable reservations and any pending reservation evidence. The
projected global and stock gross must remain within their caps. Existing V12,
PENGU and V11/V50 rank 1 positions are never closed or reduced to make room
for rank 2.

## Entry path

```text
frozen signal snapshot
  -> qualified candidates and formal rank 1/rank 2
  -> transient-only bounded retry within the 20-second window
  -> final strategy rejection
  -> AccountOrderLock
  -> durable gross reservation
  -> global/stock Gross Guard
  -> Margin Guard
  -> exchange order path
```

The only retryable reasons are `STALE_DATA`, `SOURCE_CLOCK_MISMATCH`,
`ROUND_TRIP_COST_OVER_60`, `DEPTH_BELOW_2X` and `SPREAD_OVER_20`. Strategy
rejections (`BASIS_BELOW_65`, `NET_EDGE_BELOW_5`, `SIGN_CHANGED`,
`ADVERSE_BASIS_MOVE`, `SAME_SYMBOL_ACTIVE`) are final for that window. The
runner never regenerates the signal snapshot during a retry.

## VPS activation requirements

The V52 systemd unit must execute
`scripts/disdex_v12_v52_live_engine_retry.py --mode live --daemon`. Activation
is verified read-only through preflight, managed-position reconciliation, open
order reconciliation, account ownership, Fail Closed and Kill Switch checks.
No synthetic, artificial or test order is permitted; a zero-order natural
signal period is a valid healthy result.

Runtime telemetry is stored under `v52Top2Telemetry`, including candidate rank,
qualified rank, requested/allocated gross, open/reserved global gross before
and after reservation, active slots, capture/decision timestamps, retry count,
rank 2 acceptance/rejection, order blocking and order result.
