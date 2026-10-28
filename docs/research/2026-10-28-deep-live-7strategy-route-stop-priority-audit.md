# DisDex LIVE 全ロジック・発火・出口・優先順位 コード監査 — 2026-10-28

## STATUS: MATERIAL_LIVE_ROUTE_MISMATCHES_FOUND / SOURCE_FIXES_TESTED_NOT_DEPLOYED

This report is source- and LIVE-observation-backed. **Do not infer a full source-equivalent economic BT, all-route execution certification, or venue STOP-trigger proof.** This audit made no new/test orders, position changes, STOP cancellations, kill-switch changes or LIVE strategy activations.

### Deployed LIVE lineage examined

| Strategy | Actual LIVE SHA | Source chain |
|---|---|---|
| V12 V4 | `53a0be396719f0284af4e11b35c66a4ac7d58f79` | `scripts/v12-v4-production-runner.ts` → `lib/v12-v4-live-candidate-builder.ts` → `v12-v4-v2-shadow.ts` (ranking) → `v12-v4-runner-engine.ts` → `v12-v4-production-lifecycle.ts` → resident STOP |
| Q102 Causal V4 | `ef1ab178e26a7bf5bddb6473467765edba242e1d` | `scripts/disdex-quality102-causal-v1-live-runner.ts` → `lib/disdex-quality102-causal-v1-runner.ts` → adopted exits / resident STOP |
| PENGU Dual LS V2 | `7688ed7c93a1918d8b44837339b7da5584a868f5` | `scripts/disdex-pengu-dual-ls-v2-live-runner.ts` → `lib/pengu-dual-ls-v2-portfolio-runner.ts` → `lib/pengu-short-v20-timed-stop.ts` |
| V52 | `97830672e2f139b39f7194166d7dc8c36e8c8933` | `scripts/disdex_v52_aster_only_live_engine.py` → `scripts/disdex_v52_aster_only_legacy_engine.py` |
| FET | common SHA 7688ed7c… | `scripts/disdex-fet-brk48-live-runner.ts` → `lib/fet-brk48-live-runner.ts` |
| HYPE TREND | common SHA 7688ed7c… | `scripts/disdex-hype-trend-live-runner.ts` sets MODE=TREND and imports `scripts/disdex-hype-zec-long-live-runner.ts` → `lib/hype-zec-long-runner.ts` / `lib/hype-trend-long-signal.ts` |
| IDLE SHORT + RESIDUAL LONG | common SHA 7688ed7c… | `scripts/disdex-idle-priority-short-live-runner.ts` → `lib/idle-priority-short-runner.ts` / `lib/idle-residual-long-runner.ts` |
| Shared risk | common SHA 7688ed7c… | `scripts/disdex-shared-crypto-risk-writer.ts`, daily 7.5% risk latch; legacy resident STOP observer |

### P1 confirmed defects, with code-path evidence

1. **PENGU SHORT timed losses can be starved by otherwise normal V4 STOP.** `lib/pengu-dual-ls-v2-portfolio-runner.ts:192-207` lacks V4 managed STOP whitelist; its `:948-955` nonQ102/Q102 open-order held return happens BEFORE `:957-1002` 3h -2.5% / 8h -4% confirmed M5 time exits and BEFORE `:1003-1015` shared risk flatten decision. A real V4 STOP for DOGEUSDT SHORT 226 was present during the audit and the PENGU LIVE logs contained `PENGU Dual LS will not create an order while any account open order exists.` The hard resident STOP remains independent, but the timed secondary exit / flatten evaluation is not guaranteed to run under cross-sleeve order blockers. **Research-only fix** adds already-existing `findManagedV12V4ProtectiveOrders` to `unmanagedCrossSleeveOpenOrders`; all unknown/unverified orders still BLOCK. Needs separate state/exit-first lifecycle audit, same lock/venue proof and shadow/integrated economics before LIVE promotion.
2. **HYPE legitimate V4 STOP is classified unmanaged.** `lib/hype-zec-long-runner.ts:153-163` excludes V4 matcher, and `:560` held return occurs before signal/exit evaluation. Real LIVE message `HYPE_ZEC_UNMANAGED_OPEN_ORDER_BLOCK`. Research-only fix imports strict V4 matcher, preserving fail-closed behavior for unrecognized orders.
3. **Independent HYPE actual LIVE entry differs from earlier approved BTC 3h / HYPE-BTC 3h gate.** `scripts/disdex-hype-trend-live-runner.ts` forces `TREND` and `HYPEUSDT`; `lib/hype-trend-long-signal.ts:112-155` evaluates EMA12/48, EMA240 slope, 24h breakout, etc, using BTC only for H1 time alignment, not BTC3h<=+0.6% and HYPE3h−BTC>=+2%. Read-only reproducible 320-hour synthetic signal test: BTC 3h rises over +3%, nonetheless TREND emits `HYPE_TREND_LONG_SIGNAL_ACCEPTED`. The actual `lib/hype-zec-long-runner.ts:617-621` exits at fixed quote stop, fixed TP (3 ATR), or 168h max hold; previously approved +3% arm/+1.5% floor and 1h adverse exit are not reachable here. These may represent separate historical strategy versions; **do not automatically switch entry/exit without exact BT approval**.
4. **AVAX RESIDUAL -3.5% first-touch 2-hour timer resets on interim price rebound.** `lib/idle-residual-avax-policy.ts` old code `if (!touched) return {}` and `lib/idle-residual-long-runner.ts:388-401` persists reset, conflicting with the owner's once-touched original deadline policy. Research patch retains original deadline through interim rebound; at deadline exits only if still adverse. Original AVAX 6h, -5% venue STOP, +3% arm / 1.5pp M5 trail remain separate and unchanged. 9 AVAX tests PASS, no LIVE change.
5. **V4 protective matcher accepts less than full STOP quantity.** `lib/disdex-managed-protective-orders.ts` shared `PROTECTION_TOLERANCE_PCT=0.01` was used by `v12V4ProtectionCandidate`: STOP for 225 of 226 units could be classified as managed. Distinguish managed-order classification from exact *full protective coverage*. Research patch makes the V4-specific matching threshold effectively exact; does not alter other strategies' tolerances. New negative test rejects 225/226 while accepting full 226/226. Independent owner+venue V4 STOP report previously verified actual DOGE full 226 match.

### Verified implementation / tests

- **V4 all 41 routes**: 41 catalog routes, unique route IDs and priority orders 1-41, no missing gross/rank; `buildV4LiveDecisionBatch` sorts candidates by source V2 rank; production lifecycle verifies foreign symbol, opposing side, cooldown and reservation. Actual V4 source was copied to VPS isolated staging `/home/deploy/disdex-trading/staging/v4-route-audit-only-20261028-2300`; native six-suite exit/gate/route unit tests **33 PASS**. *Caveat:* `lib/v12-v4-v2-shadow.ts:21` still has a hindsight-leakage/research BLOCKED status; separate LIVE path has independent certification; passing code tests cannot certify future performance.
- **Q102**: PB LONG after 3h with MFE<+0.5% and loss-1.5%; HIGH_VOL LONG two confirmed H1 closes loss>=3% after 2h; HIGH_VOL SHORT M5 gain>=2% floor +0.5% and gain>=3% floor +1% are referenced by the actual Q102 runner `lib/disdex-quality102-causal-v1-runner.ts:509,520,789`. Source-to-live link verified, but full annual native eight-sleeve economics missing 181d warmup for eight symbols as separately documented in branch `fix/v4-shared-stop-owner-multisha-20261028`.
- **PENGU**: SHORT 3h -2.5% /8h -4% source `lib/pengu-short-v20-timed-stop.ts` uses confirmed M5, anti-gap check; four existing staged tests PASS. Entry-side gross and portfolio cap remain 1x and shared risk max 7.5%. Current large issue is the earlier cross-sleeve order gate.
- **FET**: runtime service ACTIVE, recent last-hour logs mostly NO_SIGNAL; FET readiness monitor HEALTHY, source BRK48 and trailing policy review conducted, not full execution certification.
- **V52**: live V52 current SHA 9783, market-closed deferrals observed rather than trade failures, external AMZN SHORT Yahoo gate referenced in `scripts/disdex_v52_aster_only_legacy_engine.py`; quote/gross/stock exits not fully economically replayed this pass.
- **IDLE**: source `config/idlePriorityShortPolicy.ts` covers TAO, TIA, DOT, JUP, RENDER; `IDLE_RESIDUAL_LONG_POLICY` DOGE/AVAX, AVAX hard stop −5%, max hold6h, trailing, 2h soft watch.
- **Shared STOP**: venue DOGE SHORT 226 and reduce-only BUY STOP 226 match new read-only companion verifier, but legacy shared-risk observer still says UNKNOWN/UNVERIFIED until source-patched immutable shared-risk release certified and activated. Production code remains old, no risk gate relaxed.
- **Remaining reservation / order competition**: `DISDEX_HYPE_ZEC_PREEMPTION_ENABLED=false` on LIVE, requires explicit controlled priority research, not blindly enabled. V4 lifecycle's internal total candidate cap4.75 differs from integrated portfolio total cap4.25; final gate order and strict planner need explicit live trace before claiming this permits over-cap. ATR 2.5% user-adopted IDLE regime threshold not found in top-level `idlePriorityShortPolicy.ts`; trace actual scoring builder and skip if found elsewhere.
- **API**: occasional shared rate-budget saturated defers V4, HYPE, IDLE; no global cap bypass. HP private 7 APIs were auth-protected in prior repair.
- **Native annual BT gap**: Aster 1h data for ENA/FET/FIL/JUP/LDO/RENDER/TAO/TIA is insufficient to cover 2025-02-10 warmup for 2025-08-10 annual start; cannot claim annual exact SHA certified. 10bps/30bps older 8-sleeve results must not be reused.

### Test receipt

Production common SHA copied, patched source isolated at `/home/deploy/disdex-trading/staging/all-route-static-audit-20261028-2245`.
TSX source tests: `tests/idle-residual-avax-policy.test.ts`, `tests/idle-residual-avax-sticky-watch-contract.test.ts`, `tests/hype-pengu-v4-stop-crossrunner-owner-audit.test.ts`, `tests/hype-trend-btc3h-gate-audit.test.ts`, `tests/hype-trend-live-contract.test.ts`, `tests/pengu-short-v20-timed-stop.test.ts`: **24 passed / 0 failed**, with the strict V4 1-unit-short test.
V4 isolated six test files: **33 passed / 0 failed**.
Previous shared-risk/V4 owner patch: **29 passed / 0 failed** in different isolated stage.
No synthetic venue orders. This is **not** full integrated BT / full route real execution.

### Deployment boundary

These code changes are NOT deployed LIVE. New release must preserve old SHA operator approval, V4/Q102 split-SHA, all existing DOGE STOPs, shared 7.5% loss cap, cap and lock semantics; require exact source, CI, full native integration tests, certified safe single-RUNNER cutover and rollback. Do not change stops or orders to satisfy a test.

### Priority for followup

P0: certify HYPE/PENGU V4 STOP recognition and PENGU protective/timed exit priority with safe release.
P1: reconcile HYPE actual EMA TREND vs earlier 3h BTC-relative entry and staged profit floor via exact integrated BT; tighten V4 protection matching.
P1: adopt exact once-touched AVAX window after integrated 10/30bps economics.
P1: fill missing risk-writer V4 owner recognition, certify native eight-sleeve economics if Aster native source data becomes available.
P2: continue systematic FET, stock V52 and IDLE signal-specific priority/recovery and false-no-signal evaluation and signed authenticated HP data parity.
