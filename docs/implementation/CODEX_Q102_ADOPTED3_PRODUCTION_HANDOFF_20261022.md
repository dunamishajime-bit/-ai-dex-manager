# Q102 adopted three-exit production handoff — 2026-10-22

## Scope

This change adds three explicitly scoped Q102 exit policies while preserving
the existing Q102 entry selector, family sizing, one-slot rule, hard stop,
profit floor, trail, shared allocator, shared risk, margin guard, account
lock, and resident-stop lifecycle.

The policies are opt-in through:

```text
QUALITY102_Q102_ADOPTED_EXIT_POLICIES_ENABLED=true
QUALITY102_Q102_ADOPTED_EXIT_POLICIES_ACK=<exact runtime SHA>
```

LIVE activation fails closed unless the existing
`QUALITY102_Q102_PROFIT_FLOOR_ENABLED=true` path is also active and the new
ACK equals the exact runtime SHA. The flag is therefore bound to the release
being reviewed and cannot be enabled by a stale environment file.

## Adopted policies

1. `Q102 / PB / LONG`: after three hours, if the maximum favourable mark has
   stayed strictly below `+0.5%` and the current mark is at least `-1.5%`
   from the actual average entry, issue a reduce-only exit.
2. `Q102 / HIGH_VOL / SHORT`: retain the confirmed-M5 `+2% -> +0.5%`
   protection. A confirmed M5 close at `+3%` advances the resident stop to
   `+1%`. The stage and stop only move in the protective direction and are
   persisted before the resident-stop read-back/replacement sequence.
3. `Q102 / HIGH_VOL / LONG`: after two hours, two consecutive completed H1
   closes at or below `-3%` from the actual average entry issue a reduce-only
   exit at the next executable cycle. No prior-profit gate is used.

All three policies are family/side scoped. They do not apply to other Q102
families or sides. H1 and M5 inputs are consumed only after their candle has
closed; gaps and stale data remain fail-closed.

## Research evidence

Primary research source:

`research/q102-adopted2-hvlong-h1-2h-20261022`

`baaaed3488ff9b596cdaf248ffa8d1e1835aeba9`

The saved full-eight-logic research replay at
`DisDex_AI_Files/01_BT_Research/2026-10-22_q102_adopted2_plus_hvlong_2h_bt/`
reports:

| Cost | Final equity | Max MTM DD | PF | Closed trades |
|---:|---:|---:|---:|---:|
| 10 bps | ¥198,324,735.05909136 | -14.603309760733396% | 3.164798912181309 | 1,326 |
| 30 bps | ¥88,431,930.94000964 | -15.75383475906923% | 2.7301229466853947 | 1,323 |

These are H1/M5 price-model research results and are not historical L2 fill
certification. The research artifact itself records `venueCertified: false`.

## Production gate

Before LIVE enablement, verify the exact final SHA in the release marker,
systemd environment, operator activation artifact, Q102 runtime ACK and
`QUALITY102_Q102_ADOPTED_EXIT_POLICIES_ACK`. Reconcile positions, open orders,
pending exposure, resident stops, shared risk, margin guard, account lock and
rate budget using signed read-only venue calls. If any stop replacement or
runtime lineage check is unresolved, keep the new flag disabled and report the
exact blocker; do not substitute a mock or model result for venue evidence.
