# BT #481 — FET immutable native entry signal shadow integration (2026-11-15)

Scope: BT-only branch feat/bt-visual-gross-20261114, read-only historical source snapshot. No Codex LIVE branch, Production VPS, Runner, STOP, Kill Switch or exchange order modification.

## Verified source pin and sole source edit

Frozen read-only source checkout: C:\tmp\disdex-stable4-impl-20261114 at Git HEAD 9118eeaa6c209dc6e37887cf5be139b3baaa005d.
- FET native pure signal source: lib/fet-brk48-signal.ts, SHA256 ee8213adbb695a387e653d89bb4a494c36640e0845ffcf648ec61927fc47be78
- FET native policy config: config/fetBrk48Runtime.ts, SHA256 8a96dc4a7cf224d3012947ab882a88f71b2431f0b5b9df8adde9c7e53dfa06bf
- Copied to lib/bt-verification/pinned-native-fet. Config is byte-for-byte unchanged. Native signal module has exactly one import path substitution to refer to its colocated, pinned config; reversing that substitution reproduces exactly the recorded upstream source SHA.
- The BT adapter probe.ts is entirely separate from the native source implementation, so native FET rules, thresholds and 4-hour UTC grid were neither rewritten nor approximated.

## Actual execution path on artificial candles

The 23-asset SyntheticMarket5m stream emits an hourly FETUSDT candle only after H1 is complete. Native FET signal checks Aster close timestamps that are one millisecond before the next hour, so the BT adapter maps the already-closed synthetic candle's closedAt to closeTs=closedAt-1ms. The native buildFetBrk48Signal function receives only these immutable, contiguous, completed hourly bars.

At original native decision times (UTC hour modulo 4 = 1), at least 73 source H1 bars are required. In the ten-day H48 synthetic replay, FET signal checks are recorded as RISK telemetry with PINNED_NATIVE_ENTRY_SIGNAL_ONLY status; they create no FET position, modeled fill, stock/crypto Gross usage, simulated FET order, realized PnL or preemption event. H48 candidate remains the only executable synthetic sleeve. The source pin is shown with each FET probe result.

## Evidence and tests

- bt-hp-pinned-fet-native-selftest.ts verifies source SHA restoration and pinned config SHA, an engineered 73-hour legitimate positive breakout+volume+72h return scenario, exact equality with the native source's returned signal object, 72h return/volume failure, future-data, missing-data and gapped-hour refusal, and nine days of causal synthetic stream.
- Nine-day seed=1 trend sample: 54 native decision grid opportunities; 18 lacked necessary warmup; 36 native rejects; 0 accepted; 0 invalid. Rejection is a real, acceptable result, not a reason to relax native thresholds.
- bt-hp-multiasset-h48-replay-selftest.ts additionally requires at least 50 FET risk evaluations on the original clock and never any FET ENTRY event.
- npm run typecheck and Next.js production build pass in BT worktree. Source snapshot is NOT claimed to match current Codex runtime/Production immutable release.

## Still not certified / required next

Native FET runner quote pricing, slot selection, sizing, cooldown, native protective STOP, trailing STOP, venue funding, partial fills, Shared Risk, Gross admission, V4 priority preemption, remaining other strategy families, Q102 Online Layer2/3 and Portfolio Opportunity scoring are not included in this entry shadow probe. Neither a positive candidate nor zero candidates constitutes a full FET or STABLE4 backtest.

This design enables an honest incremental path: eventually source each native pure entry module from an immutable pin, adapt its *complete required inputs*, compare known historical candidates, and only then connect simulated fills, exits, shared risk and capital competition.
