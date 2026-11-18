# BT #481 — PENGU frozen research pretarget checks on artificial candles, 2026-11-15

## Source pin and exact research thresholds

Owner PC read-only source: DIRECTION_RESEARCH_20261109/STABLE3_REPRO_RECOVERED_20261113/portfolio_stable4_hype6_q102_dualhealth_validation_20261114.py

SHA256 e58b735a528f369d1017fd2469efdf7873c48fcfd92dde4727af40fa8a5d1d4c

The existing historical STABLE4 wrapper applies the following gates to previously generated PENGU candidate rows:
- PENGU SHORT_V20 candidate: its BTC 24h return <= -0.010836782776818987 AND PENGU 72h return <= -0.05237466490617382.
- PENGU RECOVERY_V8 candidate: its BTC 24h return <= 0.011611625094354983.

New lib/bt-verification/stable4-pengu-research-gates.ts reads the current synthetic BTC/PENGU fully-closed H1 bars as of each hourly decision time, computes exactly 24h/72h lookbacks on those bars, checks these frozen threshold constants, rejects missing/non-contiguous/future bars, and generates **regime filter telemetry only**.

This is NOT a source-pinned native PENGU entry decision: the STABLE4 historical wrapper receives candidate-row features from separate historical sources, whose exact mapping to synthetic H1 may differ. A native PENGU candidate, ShortV20/RecoveryV8 runner economics, priority, STOP, partial, sizing and slot admission remain absent. Every observation is marked NO_NATIVE_ENTRY_CANDIDATE NO_FILL. No PENGU positions, gross or profit are generated.

## Tests

- scripts/bt-hp-pengu-research-regime-selftest.ts:
  - both pretarget regimes accept an engineered BTC -2% / PENGU -6% lookback;
  - SHORT fails if BTC is not sufficiently weak or PENGU72h is insufficiently negative;
  - RECOVERY fails if BTC24h is >+1.1611625%;
  - 24/72h insufficient inputs, future candle timestamps and non-contiguous hours reject;
  - test uses exact-source research thresholds and never represents result as executed candidate.
- Nine-day seed=1, scenario=down artificial OHLCV: 216 observed closed H1, 72 warmup-blocked, 51 SHORT_V20 pretarget gate PASS. These 51 do NOT imply SHORT signals or orders.
- Ten-day BT replay logs 480 risk events (240 hours x 2 research filters), all marked NO_FILL and with no PENGU position or realized trade.
- npx tsx tests and TypeScript npm run typecheck PASS; Next.js production build verified separately.

## Remaining independent gates

The native PENGU V2 engine, ShortV20 and RecoveryV8 actual signal builder, states, exits and exposure require source-pinned explicit injection of synthetic history and the original candidate lifecycle. Shared Risk, Gross, Layer 2 Online and opportunity comparison are also absent. The task is still blocked for integrated portfolio BT and LIVE economic parity. The frozen Source wrapper is read-only; Codex LIVE process and VPS were not changed.
