# DD14 Research Snapshot — 2026-10-05

## Recommended research configuration

- PENGU gross 1.0
- PENGU limited 2% structural re-break
- HYPE75
- Q102 HIGH_VOL SHORT max 0.70x
- Q102 REV SHORT max 1.25x
- Q102 PB LONG max 2.0x
- FET entry gate: 72h return >= +2%
- FET re-entry cooldown: 24h after FET exit
- V12 directional loss cooldown: after 6 consecutive losses in the same side, block that same side for 6h
- V52 / IDLE / RESIDUAL unchanged

## Integrated 10 bps result

- Final equity: JPY 3,270,844,178.208338
- Profit factor: 2.7752053327781114
- Maximum MTM drawdown: -14.115749472086048%
- Closed trades: 1,359
- Ownership conflicts: 0
- Accounting reconciliation: PASS

## Strategy PnL

- V12: JPY 1,211,726,495.6829662
- Q102: JPY 479,613,113.15392053
- PENGU: JPY 130,710,041.26685299
- V52: JPY 597,656,958.7928783
- HYPE_LONG: JPY 248,710,496.6666784
- IDLE: JPY 521,366,552.3964997
- RESIDUAL: JPY 34,249,048.06206238
- FET: JPY 85,731,423.77042076

## FET loss repair evidence

Before repair, problematic 24h time-exit losses were observed on 2026-06-27, 2026-07-10, and 2026-08-04.

Research repair:
1. Require FET 72h return >= +2%.
2. After any FET exit, block new FET entry for 24h.

Result under final portfolio:
- FET trades: 8
- Wins / losses: 7 / 1
- Win rate: 87.5%
- The three problematic 24h time-exit losses are removed.
- Remaining FET loss is a CORE_PREEMPT:V12 event, not a 24h time-exit loss.

## V12 consecutive-loss repair evidence

Under the optimized Q102/FET portfolio, the comparison baseline produced a 10-loss V12 streak concentrated in SHORT entries.

Tested:
- 2-loss and 3-loss fixed cooldowns: rejected, too destructive to recovery trades.
- 3-loss short-term regime reconfirmation: did not improve maximum DD.
- 5-loss / 12h cooldown: max streak reduced to 6 but final equity lower.
- 6-loss / 6h same-side cooldown: selected best balance.

Selected result:
- V12 trades: 999
- Wins / losses: 632 / 367
- Win rate: 63.26%
- Maximum loss streak: 8
- V12 PnL: JPY 1,211,726,495.6829662
- Same-side cooldown rejected entries: 5

## Remaining maximum-DD episode

Peak: 2025-09-26 11:00 UTC
Trough: 2025-09-26 22:00 UTC
DD: -14.11574947208606%

Open unrealized losses at trough included:
- Q102 APT SHORT, family REV, gross 1.25x
- PENGU SHORT
- V12 SOL SHORT

Realized losses between peak and trough included Q102 REV preemption of V12 AVAX/SOL.

This snapshot is research-only. It does not modify VPS/LIVE runtime.
