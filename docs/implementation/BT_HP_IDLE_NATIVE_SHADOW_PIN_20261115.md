# BT #481 — IDLE frozen native entry and STABLE4 pretarget gates, 2026-11-15

## Immutable source and isolation

BT research branch feat/bt-visual-gross-20261114 only. Read-only copy from separate Codex-owned worktree Git HEAD 9118eeaa6c209dc6e37887cf5be139b3baaa005d.

Native source:
- lib/idle-priority-short-signal.ts SHA256 76f68ba1ec78f5adb34c68718a28b199f58bd29dd6651a404631326906c2f827
- config/idlePriorityShortPolicy.ts SHA256 4faf0c02fcfad787305da17b75ca4ae8cfc9144681cea631cdfa7b340f8fe760
- Isolated copies in lib/bt-verification/pinned-native-idle. Only import path within native signal changes to colocated policy file; restoring the original import yields exactly the native source SHA. Configuration bytes unchanged.

## Injected artificial H1, pure source, then research filters

- Every input H1 candle must be fully closed by evaluation UTC H1, contiguous, valid OHLC/quoteVolume, exactly 12 observed five-minute ticks. The adapter feeds genuine pure functions computeIdlePriorityFeatures, evaluateIdleGenericCandidate and evaluateIdlePriorityShort.
- The native generic archetype priority is BREAKOUT -> RELATIVE -> MOMENTUM, with LONG/SHORT lifecycle candidate distinctions. These pure entry candidate functions do NOT implement baseline admission, per-route 12h slot ownership, capital, live STOP or exchange order.
- STABLE4 research-only JUP pretarget gate: rel24 >= -0.04089204262472046 and volumeRatio >= 1.2568362211142174, applied only to a JUP native entry candidate after pure native acceptance.
- RENDER route is refused at the research gate (RESEARCH_RENDER_WAIT) even if the native pure entry is accepted.
- Native TAO candidate is marked TAO_SENSOR_ONLY: historical research used 12-hour risk-off windows from its prefiltered TAO candidates. The separate portfolio-wide risk-off state and lifecycle are not yet integrated, so no TAO fills or false "risk window complete" status.
- DOT receives its genuine native entry candidate, labeled RESEARCH_PRELIMINARY_PASSED only: no order or risk admission.
- TIAUSDT is defined in the pinned native IDLE policy but missing from synthetic market v1. The adapter returns MISSING_SYMBOL every time and NEVER silently fills, ignores or normalizes away its input deficiency. Future v2 feed should add TIA with explicit source version to preserve v1 seeded reproducibility.

## BT UI and evidence

Ten-day 23-symbol synthetic H48 research replay now includes IDLE-native-shadow diagnostics for all five routes on each completed H1, including TIA's explicit MISSING_SYMBOL. Each event is RISK-only (no ENTRY, no PnL), with the snapshot revision and NO_FILL marker.

Test bt-hp-pinned-idle-native-selftest.ts checks the pin restoration hashes, independently engineered genuine JUP pass and research gate failure, RENDER native pass but research wait, TAO native pass but sensor-only, DOT native momentum pass, invalid/future/gapped H1 rejection, 216 artificial hours with 0 source validity errors, and TIA fail-closed. Seed=1 down nine-day sample yielded 111 accepted or research-blocked native candidates, 465 native rejects and 216 TIA missing-symbol blocks. These are signals, NEVER trades.

Test bt-hp-multiasset-h48-replay-selftest.ts checks exactly 5x240=1,200 IDLE source diagnostic events during ten-day model replay, clock alignment, exact missing symbol cases, no IDLE position, source identity and unchanged H48 model ledger.

## Remaining limits

No LIVE system/Runner touched. Native full IDLE has additional baseline, 12h generic candidate slot lifecycle, formal priority, per-position STOP/TP/hold, TAO risk-off and JUP external quality gates. Pre-target H48+IDLE+D20 source parity, shared risk and 7-family STABLE4 Layer2/3 economic parity remain unverified. Artificial-signal candidate acceptance cannot be treated as actual fill or profit.
