# V12 V4 D-tier yield: ONLY IF NO FREE GROSS (2026-10-26)

User-confirmed design principle, research only. DO NOT deploy or close existing positions.

When a higher-priority strategy triggers, do not sell D positions to increase an order that can already be accepted with spare shared Gross. Only consider D yielding if the higher-priority entry has passed all its actual causal admission/risk checks but has ZERO free applicable Gross.

Research gross tiers: REC_G3=0.25, REC_X13=0.15, CONT_SHORT=0.15; nine C Recovery routes already adopted at 0.25; other four D routes stay 0.05.

## Frozen eight-strategy H1 backtest (2025-08-10 to 2026-08-10)

| Variant | 10bps final JPY | 10bps DD | D yield count | 30bps final JPY | 30bps DD | D yield count |
|---|---:|---:|---:|---:|---:|---:|
| No extra yield | 304,799,546 | -20.3402% | 0 | 193,683,203 | -18.3495% | 0 |
| Yield on ANY shortage | 302,859,135 | -20.4074% | 1 | 193,683,203 | -18.3495% | 0 |
| Yield ONLY when free shared Gross is zero | 304,799,546 | -20.3402% | 0 | 193,683,203 | -18.3495% | 0 |

No-free-Gross-only yielded 0 events and exactly reproduced no-yield base for final assets, DD, count and trade ledger SHA at 10bps and 30bps. Accounting PASS. It avoids previous 10bps needless yield (REC_G3 AVAX SHORT forced exit so V52 AMZN entry that was ALREADY ACCEPTED could increase from approx gross 1.955x to 1.997x); that any-shortage variant worsened full-year wallet by JPY 1,940,410.

## Contract for later live certification
1. Evaluate current available strategy, crypto, total, cross-asset Gross and pending reservations with venue margin. This H1 research models only shared crypto/total free Gross exactly zero, with positive strategy room. Same-strategy cap and exact lot/notional feasibility remain unproven.
2. Higher-priority candidate must pass owner/same-symbol/side, score, causal signal freshness, cooldown, strategy slots, account lock, shared loss, margin guard, kill switch and venue minimum notional. Pure candidate signal is NOT enough.
3. No yielding if any usable Gross remains. Do not force close merely because requested amount exceeds available gross by a small amount. If a candidate can be placed with smaller permissible size, place it without closing D, subject to existing sizing policy.
4. Only eligible G3, X13, CONT D positions could be yielded. Never preempt another portfolio owner just to boost lot size. Compute smallest necessary exit and compare exit cost, spread and opportunity loss. If no order-ready upper candidate, reject rather than close.
5. Venue-proof two-phase reconciliation: pending/shared reservation, resident protective STOP safety, D reduce-only close, signed fill, updated balance/exposure and fresh upper candidate order. Fail closed on uncertainty, duplicate, partial-fill, stale evidence or restart.
6. NEVER touch the existing AAVE/NEAR positions as a side effect. No live deployment is authorized by these research results alone.

Source: scripts/research/v12_v4_d_tier_preemption_no_free_gross_20261026.py.
Data: docs/research/results/v12-v4-d-tier-preemption-20261026/V12_V4_D_TIER_NO_FREE_GROSS_ONLY_10_30BPS_20261026.json.

Zero actual preempt events means future economic uplift and safe LIVE implementation are NOT established. Frozen 2026-10-09 model excludes the latest venue/L2 and exit lifecycle changes.
