# PENGU Recovery V8 Design

## Status

This design is based on the research freeze branch `research/pengu-recovery-v8-final-20260828` at SHA `15c0b7586710c9db1c46b376bb5041203fc7d826` and its `sourceProductionSha` `a76fd7aaa0788209532a5a2c6489135dd8e4a27e`. It defines a research-to-production implementation only; it does not authorize LIVE, VPS, production, or exchange changes.

## Goal

Add only the frozen Recovery V8 supplemental Long sleeve to PENGU DUAL LS V2, with deterministic entry/exit parity, one-time delayed partial defense, durable restart state, and safe order reconciliation, while leaving V12 and V52 unchanged.

## Frozen policy

The freeze file is the sole source of Recovery V8 parameters. No environment override or re-optimization is allowed.

- Entry rule: `R_BTC3`
- Priority: `SHORT_FIRST`
- Initial gross: `0.50`
- Yield mode: `BASE_LONG`
- Competition: an eligible ordinary Short is selected before Recovery; an eligible ordinary/base Long is selected before Recovery; Recovery is selected only when those competing base signals are not selected.
- Hard stop: Long price at or below entry price minus 6%.
- Trail activation: favorable Long move of at least 6% from entry.
- Trail retrace: 3% from the favorable high watermark.
- Maximum hold: 72 hours, using the next completed decision bar consistent with the existing simulator.
- Structural buffer: disabled (`null`).
- Delayed partial defense: after at least 24 hours from entry, if a completed bar reaches entry price minus 4%, submit one reduce-only partial exit for gross `0.25`; the remaining gross is `0.25`.
- Breakeven protector: disabled.
- Static ATR/BTC guard: disabled.
- Staged entry: disabled.

The fixed R_BTC3 research transform must be ported without changing its thresholds or event ordering. Its frozen threshold values are `rsiDelta6Min=7.392354615445917`, `ema168DistanceMinPct=-5.864583483302943`, and `btcReturn6hMinPct=0.20571786048402818`; R_BTC3 requires all three conditions after the deduplicated three-point recovery cross. The implementation must fail closed if the required recovery features cannot be computed rather than inventing fallback values.

## Architecture and data flow

1. `config/penguRecoveryV8.ts` will hold a typed, immutable policy and the freeze metadata. It will not read tunable V8 values from environment variables.
2. `lib/pengu-recovery-v8.ts` will contain pure entry and position-bar evaluation. It will consume the existing PENGU feature rows and expose a typed Recovery V8 entry decision and exit/partial decision. The evaluator will use completed H1 bars only.
3. `lib/pengu-dual-ls-v2.ts` will call the Recovery evaluator after the existing ordinary Short and base Long decision logic. The existing ordinary Long/Short conditions and V20 state machine remain unchanged. Recovery V8 is a distinct entry lineage, not a mutation of `SHORT_V20`.
4. `lib/pengu-dual-ls-v2-runner-state.ts` will extend durable state with a validated `recoveryV8` position substate containing `entryTs`, `originalGross`, `remainingGross`, and `partialDefenseTriggered`. Existing legacy and Short V20 states remain loadable and are never retrofitted with V8 state.
5. `lib/pengu-dual-ls-v2-portfolio-runner.ts` will add a pending action type for `RECOVERY_V8_PARTIAL_EXIT`. A partial action is persisted before execution, uses the existing idempotency and reduce-only executor path, and is reconciled on restart before any new decision. A filled partial reduces both state quantity and remaining gross; it does not clear the position. Unknown, non-filled, or quantity-inconsistent results remain manual review/Fail Closed.
6. A deterministic backtest/parity harness will replay the same completed-bar event ordering as the pure evaluator. It will charge separate entry and partial/final-exit fees, funding, and slippage for the actual gross tranches. It will emit fixed historical and external diagnostic fields and refuse to report PASS on any mismatch.

## State and action invariants

- A Recovery V8 entry creates `originalGross=0.50`, `remainingGross=0.50`, and `partialDefenseTriggered=false`.
- The partial defense is eligible only when `referenceTs >= entryTs + 24h` and the completed bar low is at or below `entryPrice * 0.96`.
- The partial defense can transition from false to true at most once. It cannot be recreated after a successful partial fill or while a partial pending action exists.
- The same bar checks adverse hard stop before partial defense. If both are touched, the full hard stop is the only action and no partial action is emitted.
- After partial fill, remaining gross is exactly `0.25` in the policy state; quantity is reduced by the filled quantity and must reconcile to the exchange position.
- The remaining position continues to use the original entry price, high watermark, 6% hard stop, 6% trail activation, 3% retrace, and 72-hour max hold.
- Restart loads the pending action or the Recovery V8 position state before reading new signals. Missing or invalid V8 fields fail closed for manual reconciliation.
- A base Long decision always wins over a Recovery entry on the same completed bar. `SHORT_FIRST` governs the ordinary Short versus Recovery competition and keeps ordinary Short first.
- No Recovery logic may alter V12/V52 files, settings, services, or state.

## Testing and acceptance

The implementation must add automated tests before production code changes and verify the red-green cycle for each new behavior:

- no partial before 24 hours;
- no partial at or after 24 hours without the -4% adverse level;
- one 0.25 partial at or after 24 hours when the level is reached;
- no duplicate partial after repeated qualifying bars;
- ordinary Short priority and BASE_LONG yield;
- hard-stop precedence on a same-bar collision;
- post-partial remaining gross and continued original exits;
- restart normalization and invalid-state Fail Closed;
- pending partial reconciliation and no blind retry;
- fees, funding, and slippage on separate tranches;
- Normal and Severe frozen replay outputs.

The freeze acceptance values are exact comparisons within the existing numeric tolerance policy:

| Diagnostic | Return % | PF | MaxDD % | Trades |
|---|---:|---:|---:|---:|
| Historical Normal | 574.2299381960086 | 4.331158674670027 | -12.848857788628465 | 70 |
| Historical Severe | 395.5575708353778 | 3.4431875382578734 | -14.773631389772579 | 70 |
| OKX Normal | 1.708116883131927 | 1.2941276595322444 | -4.774806673972343 | fixed external diagnostic |
| Bitget Normal | 1.0641829160857874 | 1.1764674390670848 | -4.773000658193871 | fixed external diagnostic |
| Gate Normal | 4.045017900309222 | 1.6291217581000639 | -4.613883091268245 | fixed external diagnostic |

The observed forward values `+0.36572114156578905%` Normal and `-1.1536741149536844%` Severe are labeled already observed diagnostics, never fresh holdout validation.

The final command set must prove `ORDERS_SENT=0`, `LIVE_CHANGED=FALSE`, `VPS_CHANGED=FALSE`, and `PRODUCTION_CHANGED=FALSE` for this branch's work. Any numeric mismatch, missing state restoration, reconciliation discrepancy, or safety assertion failure produces a fail-closed result and prevents the final implementation claim and push.

## Out of scope

- V12 logic, parameters, entry conditions, or state.
- V52 logic, parameters, entry conditions, or state.
- V8 parameter tuning or new filters.
- +5% breakeven protection, static ATR/BTC guard, staged entry, or recovery re-entry.
- VPS, systemd, deployment, LIVE activation, production configuration, exchange requests, test orders, cancellations, or settlements.
