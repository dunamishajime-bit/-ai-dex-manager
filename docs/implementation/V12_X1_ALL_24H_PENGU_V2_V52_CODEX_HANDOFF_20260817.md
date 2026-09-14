# V12 1.00x / 24H + PENGU V2 + V52 Stocks — Codex implementation handoff

## Status and decision

- Handoff status: `IMPLEMENTATION_SPEC_READY`
- User-selected variant: `V12_X1.00_ALL`
- V12 multiplier: `1.00`
- V12 entry policy: `ALL` — new entries are allowed 24 hours a day
- Portfolio priority for simultaneous new entries: `STOCK_FIRST`
- Existing-position policy: no pre-emption, no forced rebalance, no later top-up
- V96: excluded
- Intended first runtime mode after implementation: `SHADOW`, then `PAPER`
- LIVE activation: explicitly out of scope for this handoff
- VPS mutation, service restart, order submission and kill-switch release: prohibited in this task

This document records the exact implementation target chosen on 2026-08-17. The previous operationally conservative suggestion of V12 0.50x is superseded for this implementation handoff by the user's explicit selection of the top backtest row, `V12_X1.00_ALL`.

The implementation must default to disabled/SHADOW and must not become LIVE merely because code is merged or deployed. A separate immutable-release review, VPS preflight and explicit LIVE activation request are required later.

## Source-of-truth lineage

| Component | Immutable source |
|---|---|
| Combined research result | commit `3c46f456128e2be45d6eb616da1b27b9c8bf0ef6` |
| Combined research branch | `research/v12-v52-pengu-v2-combined-1y-20260816` |
| VPS lineage used by the backtest | `6f4d06fd990e5e847895b59c4890bb80335ff03e` |
| Frozen V12 source | `27f023a37d08b71c6e59b797fdc03c20d6032da2` |
| V52 stock research source | `04c1a369223bd27e9e42bc93604b3777b9230d92` |
| V11 stock dependency | `0fad24c105a7f0f61af6042ba04a8b1386ffec7c` |
| V13 stock dependency | `dbfd7e026a81343a23ab97d202761f7f9bbe5755` |

Controlling files:

- V12 frozen research behavior: `scripts/research_v26_latency_aware_v9.ts` at the frozen V12 SHA
- V12 ledger adapter: `scripts/research_v12_combined_bt_ledger.ts`
- PENGU V2 production configuration: `config/penguDualLsV2Runtime.ts` at the VPS-lineage SHA
- PENGU V2 signal/exit logic: `lib/pengu-dual-ls-v2.ts` at the VPS-lineage SHA
- PENGU V2 portfolio runner: `lib/pengu-dual-ls-v2-portfolio-runner.ts` at the VPS-lineage SHA
- PENGU V2 process entrypoint: `scripts/disdex-pengu-dual-ls-v2-live-runner.ts` at the VPS-lineage SHA
- V52 stock engine: `scripts/disdex_v52_aster_only_live_engine.py` at the VPS-lineage SHA
- V11 stock base rules: `scripts/disdex_v13d_v11eq_stock_live_engine.py` at the VPS-lineage SHA
- Free reference policy: `scripts/disdex_v13d_v11eq_stock_free_live_engine.py` at the VPS-lineage SHA
- Combined portfolio simulator: `scripts/research_v12_v52_pengu_v2_combined_bt.py`
- Full research output: `docs/research-results/v12-v52-pengu-v2-combined-latest.json`

Important: the raw `research_v26_latency_aware_v9.ts` file alone is not the complete V12 ledger contract. The exact V12 behavior used by the unified test is the frozen source plus the deterministic transformations in `research_v12_combined_bt_ledger.ts`. Codex must port that generated behavior, then prove parity against the frozen ledger. It must not copy only the strategy name or reconstruct the logic from this prose.

Before implementing, Codex must discover the repository's actual current default-branch SHA and the actual VPS deployed SHA. If the VPS is no longer on `6f4d06fd990e5e847895b59c4890bb80335ff03e`, Codex must not overwrite newer changes. It must rebase the implementation on the current source, report the divergence and retain the immutable sources above for parity tests.

## Selected one-year result

Period: `2025-08-10T00:00:00Z` inclusive through `2026-08-10T00:00:00Z` exclusive, 365 calendar days.

| Metric | Normal | Severe |
|---|---:|---:|
| Compounded return | `+889.7947479%` | `+189.4743864%` |
| Profit factor | `3.30648586` | `2.15128027` |
| PF without best trade | `3.15630368` | `2.00123085` |
| Closed-event max drawdown | `-12.07387354%` | `-16.27200837%` |
| Closed events | `381` | `206` |
| Positive month rate | `92.30769231%` | `61.53846154%` |
| Worst month | `2026-07: -2.12714551%` | `2026-07: -7.67988268%` |
| Maximum V12 gross | `1.0` | `1.0` |
| Maximum PENGU gross | `0.75` | `0.75` |
| Maximum crypto gross | `1.5` | `1.5` |
| Maximum stock gross | `1.5` | `0.0` |
| Maximum total gross | `2.5` | `1.5` |

Normal sleeve events were V12 `218`, PENGU V2 `31`, V11-EQ `50` and V50 `82`. The normal routing simulation scaled V12 `33` times, scaled PENGU once, blocked one PENGU entry and one V12 entry through the crypto daily-loss latch, scaled V50 `16` times and blocked the same stock symbol `33` times.

The severe stock-cost model rejected all `57` V11 candidates and all `165` V50 candidates before entry. Therefore the severe portfolio row is effectively V12 plus PENGU, not evidence that stock execution remains profitable at 100 bps round-trip cost.

This latest year overlaps strategy research and is not an untouched holdout. Combined drawdown is based on completed events because a synchronized mark-to-market path for all sleeves was unavailable. Intratrade drawdown may be worse. These values are research evidence, not a live-return forecast.

## Target architecture

The target portfolio consists of exactly these sleeves:

1. `V12` — frozen 14-symbol crypto relative-strength strategy, at-most-one open V12 position.
2. `PENGU_DUAL_LS_V2_FINAL` — existing PENGUUSDT long/short strategy, unchanged signal parameters.
3. `V11_EQ` — existing V52 stock opening-basis slot.
4. `V50_POST_OPEN_BASIS` — existing V52 post-open stock slot.

`V96` must remain excluded. Do not start, enable, migrate or allocate capital to V96 as part of this work. Legacy identifiers containing `V96` may remain where required for state compatibility, but the effective runtime composition and preflight report must clearly state `v96Included=false`.

## Exact V12 strategy contract

### Market and schedule

- Venue model: Aster perpetual Futures API V3.
- Input candles: completed 1-hour candles resampled into UTC-aligned 2-hour bars.
- Decision interval: every completed 2-hour bar.
- Entry: next 2-hour bar open after a valid completed-bar signal.
- Entry policy: `ALL`; no JST, US-RTH or weekday entry restriction.
- Exits and venue-resident protective stops: active 24/7.
- Maximum simultaneous V12 positions: one.
- Long and short are both enabled.
- Universe, in frozen order: `BTC`, `ETH`, `BNB`, `SOL`, `LINK`, `AVAX`, `DOGE`, `INJ`, `XRP`, `ADA`, `LTC`, `ATOM`, `AAVE`, `NEAR`.

Incomplete bars, duplicate timestamps, missing expected 1-hour/2-hour bars, non-finite values or insufficient warm-up must produce no entry. They must never be filled with future data or silently interpolated.

### Frozen V12 parameters

| Parameter | Value |
|---|---:|
| `timeframeHours` | `2` |
| `leverage` | `1.0` |
| `riskPerTradePct` | `3.19` |
| `maxMarginUsagePct` | `100` |
| `btcRegimeSmaBars` | `53` |
| `btcRegimeMomentumBars` | `52` |
| `regimeThresholdPct` | `0.0377` |
| `momentumBars` | `45` |
| `breakoutBars` | `18` |
| `breakoutBufferPct` | `0.0233` |
| `minimumMomentumPct` | `0.0227` |
| `minimumVolumeRatio` | `0.9845` |
| `minimumEdgeToCostRatio` | `6.0879` |
| `volatilityLookbackBars` | `15` |
| `volatilityPenalty` | `2.3953` |
| `atrBars` | `31` |
| `stopAtr` | `2.477` |
| `takeProfitAtr` | `3.1995` |
| `trailingAtr` | `0.4` |
| `maxHoldBars` | `23` = 46 hours |
| `rebalanceBars` | `20` = 40 hours |
| `cooldownBars` | `1` = 2 hours |
| `allowNeutralRegime` | `true` |
| `neutralScoreThreshold` | `1.4649` |

The strategy was selected under normal V12 execution cost of 5 bps per side and zero modeled slippage. Production must not pretend zero slippage; it must record actual fills and reject entries outside the approved execution guard. The severe test used 10 bps fee plus 5 bps slippage per side, deterministic 5% missed claimed-owner entries and a one-bar/2-hour trailing-stop update lag.

### BTC regime

For the current completed 2-hour BTC bar:

- `dist = BTC close / SMA53 - 1`.
- `btcMomentum = BTC close / BTC close[52 bars ago] - 1`.
- Long regime: `dist >= 0.0377` and `btcMomentum > 0`.
- Short regime: `dist <= -0.0377` and `btcMomentum < 0`.
- Otherwise the regime is neutral.

### Candidate feature and ranking

For every universe symbol on the same completed 2-hour timestamp:

- 45-bar momentum: `m = close / close[45 bars ago] - 1`.
- 15-bar volatility: sample standard deviation of log returns.
- 31-bar ATR: mean true range.
- Volume ratio: current volume divided by the mean of the preceding 20 bars.
- Expected normal round-trip cost: `(5 + 5) / 10_000 = 0.001`.
- Minimum cost-derived move: `0.001 * 6.0879 = 0.0060879`.
- Reject if volume ratio is below `0.9845`.
- Reject if `abs(m)` is below the cost-derived minimum.
- Long requires `m >= 0.0227`.
- Short requires `m <= -0.0227`.
- `scale = max(0.0001, volatility * sqrt(45))`.
- Raw score: `m / scale`.
- Penalized score: `rawScore / (1 + 2.3953 * volatility * 100)`.
- Long is eligible in the BTC long regime, or in neutral when penalized score is at least `1.4649`.
- Short is eligible in the BTC short regime, or in neutral when the negated penalized score is at least `1.4649`.
- Rank eligible candidates by descending positive side-adjusted score, then ascending symbol as the deterministic tie-breaker.
- Select only the top candidate.

Parity warning: the frozen source calculates the prior 18-bar high/low and contains `breakoutBufferPct`, but does not apply an actual breakout-price comparison in `signal()`. The prior high/low currently acts only as a data-availability check. Codex must preserve this exact behavior for V12 parity. It must not add a breakout filter merely because the parameter name suggests one.

### V12 sizing

- Initial stop distance: `max(ATR31 * 2.477, entryPrice * 0.005)`.
- Risk capital: current V12-account equity times `3.19%`.
- Risk-sized notional: `riskCapital / (stopDistance / entryPrice)`.
- Margin-sized notional: equity times `1.0 leverage` times `100%` maximum margin usage.
- Raw requested notional: minimum of risk-sized and margin-sized notional.
- Raw requested gross: raw requested notional divided by current account equity.
- Selected multiplier: `rawRequestedGross * 1.00`.
- Final allocated gross is the raw request clipped by the shared crypto and total portfolio capacity described below.

`1.00x` is a multiplier, not an unconditional order at gross 1.0. A request can be below 1.0 through risk sizing and can be further reduced by portfolio capacity. A later capacity increase must not top up an already-open V12 position.

### V12 entry and protection

- Entry price uses the next 2-hour bar open in parity tests; production uses the actual normalized fill.
- Entry fee and fill data must be persisted before position state is considered active.
- Immediately after an entry fill, place and verify an Aster venue-resident `STOP_MARKET` protective order.
- Initial stop is entry minus the stop distance for long and entry plus the stop distance for short.
- Take profit is entry plus `ATR31 * 3.1995` for long and entry minus it for short.
- Trailing distance is `ATR-at-entry * 0.4`.
- Long trailing candidate: `max(initialStop, peakPrice - ATR-at-entry * 0.4)`.
- Short trailing candidate: `min(initialStop, troughPrice + ATR-at-entry * 0.4)`.
- Never loosen a resident stop.
- Update the trailing stop only from completed 2-hour information.
- If a stop update fails, the last exchange-acknowledged stop remains authoritative. Do not cancel the last valid stop before the replacement is accepted and reconciled.
- If entry fills but protective-stop installation cannot be proved, flatten the new managed position reduce-only and activate Fail Closed/manual review.
- Every stop/TP/exit client order ID must be deterministic and restart-safe.

Within a bar the frozen simulator checks liquidation, then stop, then take profit. Production exchange behavior may differ when multiple trigger prices are crossed between observations; record this as execution divergence rather than changing the historical simulator.

### V12 holding, rotation and exit

- Hard maximum hold: 23 completed 2-hour holding bars.
- After 20 holding bars, if the top signal changes symbol or side, schedule `signal-rotation`.
- Rotation exits at the next bar open, then may enter the new candidate only after the exit is reconciled and capacity is recalculated.
- A stop or take-profit exit starts a one-bar/2-hour cooldown.
- Do not reverse or add while the V12 slot is occupied.
- End-of-window closure exists only in backtests and must not become a production calendar exit.

Production state must retain at least strategy ID, source SHA, position ID, symbol, side, signal/reference timestamp, entry timestamp, fill price, quantity, requested/allocated gross, ATR at entry, initial stop, last exchange-acknowledged resident stop, TP, peak/trough, holding bars, cooldown, pending order, idempotency key, last decision and failure/manual-review history.

## Existing PENGU V2 contract — preserve, do not retune

The controlling production strategy is `PENGU_DUAL_LS_V2_FINAL` on completed, fully aligned PENGUUSDT and BTCUSDT 1-hour candles.

### PENGU Long

- PENGU 72-hour return at least `+15%`.
- Close strictly above the prior 18-hour high.
- PENGU 24-hour return at least `+10%`.
- PENGU minus BTC relative 24-hour return at least `+1%`.
- BTC 24-hour return at least `0%`.
- RSI14 from `48` through `78`.
- Recent 6-hour volume / prior 36-hour mean volume from `0.25` through `3.0`.
- ATR24 / close no more than `5%`.
- Close above PENGU EMA168.
- Signal only on the false-to-true edge of the full Long condition.

### PENGU Short

- Start a setup when PENGU 24-hour return is at most `-7%`.
- Setup expires after 24 hours.
- Arm after a bounce of at least `+1.25%` from the local low.
- Invalidate if the bounce exceeds `+6%`.
- Trigger only when all conditions hold: PENGU 72-hour return no more than `0%`; close below previous low; close below EMA72; EMA72 below EMA168; relative 24-hour return no more than `-2%`; volume ratio `0.25` through `3.0`; BTC 24-hour return no more than `+4%`; PENGU 24-hour return at least `-12%`; BTC distance from BTC EMA168 at least `-4%`; RSI14 at least `30`.

Short takes precedence if Long and Short would both be eligible on the same completed bar.

### PENGU execution, sizing and exit

- Enter on the next 1-hour boundary, within the existing maximum entry delay of 5 minutes.
- Gross target: `clip(0.75 * 0.02 / atr24Ratio, 0.60, 0.75)`.
- Maximum PENGU gross: `0.75`.
- Long hard stop: `8%`; trailing activates at `+10%`, retrace `3%`; maximum hold 120 hours.
- Short hard stop: `8%`; trailing activates at `+15%`, retrace `4%`; maximum hold 72 hours.
- Cooldown after exit: 6 hours.
- No add, reverse or second PENGU position while occupied.
- Existing maximum slippage guard: 35 bps.
- Existing minimum order notional: USD 5.
- Existing retry maximum: 5, but an UNKNOWN/final non-filled order goes to manual review; no blind duplicate order.
- Existing unmanaged-position behavior remains Fail Closed/manual review; `closeUnmanagedPositions=false`.

The current TypeScript production replay produced 32 trades, while the earlier frozen Python checkpoint contained 30. The current TypeScript production logic is controlling. Preserve this warning and do not retune PENGU to force the old count.

## Existing V52 stock contract — preserve, do not retune

Stock universe: `AMZN`, `META`, `MSFT`, `NVDA`, `TSLA` on Aster stock perpetuals with Pyth primary and Alpaca IEX validation.

Reference safety remains Fail Closed:

- Pyth maximum age: 5000 ms.
- IEX maximum age: 5000 ms.
- Pyth maximum confidence: 25 bps.
- Maximum cross-source divergence: 50 bps.
- Aster/reference source-clock difference used by V11/V50: 1500 ms.
- Do not increase freshness, confidence or divergence limits.
- Do not substitute a stale-price fallback.
- The previously observed META IEX age of 5396 ms must still reject the tick rather than weaken the gate.

### V11-EQ slot

- Record all five Aster/reference bases around 10:00 New York time.
- Select the largest absolute basis, deterministic symbol tie-break.
- Attempt entry once around 10:30 New York time only if the selected symbol remains current top-1.
- Entry basis magnitude at least 50 bps.
- Estimated round-trip cost no more than 60 bps.
- Cost/basis ratio no more than 75%.
- Minimum net edge uses the deployed free-reference override of 20 bps.
- Exit-side Aster depth at least 2x target notional.
- Spread no more than 20 bps.
- At least five recent spread observations and spread/30-second median no more than 2x.
- Adverse two-second move no more than 5 bps.
- Adverse basis move from the 10:00 signal no more than 10 bps.
- Post-only entry, 10-second TTL and minimum fill ratio 90%; flatten partial low fill.
- Exit when basis converges to 15 bps or crosses zero, when basis magnitude reaches 1.5x entry basis, or at 15:30 New York.

### V50 post-open slot

- Signal/entry windows: 11:30, 12:30 and 13:30 New York.
- Maximum three completed V50 trades per New York day.
- One V50 position at a time; no same stock symbol as the active V11 slot.
- Entry basis magnitude at least 75 bps.
- Signal/current basis sign must remain unchanged.
- Adverse basis expansion no more than 10 bps.
- Estimated round-trip cost no more than 60 bps.
- Net edge after 15-bps convergence and cost at least 10 bps.
- Exit-side depth at least 2x notional and spread no more than 20 bps.
- Exit when basis converges to 15 bps or crosses zero, when basis magnitude reaches 1.5x entry basis, after three hourly checks/three hours, or at 15:30 New York.
- A missed checkpoint by more than five minutes closes Fail Closed.

V11 and V50 each have a slot cap of 1.0. The first stock position requires at least 0.50 available gross; the second requires at least 0.25. Total stock gross is capped at 1.5. The stock daily-loss limit is 3.5%.

## Shared portfolio router and overlapping orders

### Frozen caps

| Limit | Value |
|---|---:|
| Total Aster portfolio gross | `2.5` |
| Crypto gross, V12 + PENGU | `1.5` |
| Stock gross, V11 + V50 | `1.5` |
| V12 raw maximum gross | `1.0` |
| PENGU maximum gross | `0.75` |
| PENGU existing all-other-Aster portfolio cap | `1.5` |
| V11 slot cap | `1.0` |
| V50 slot cap | `1.0` |

Gross is absolute notional divided by current Aster equity. Long and short both consume positive gross. Open orders and durable reservations must also consume capacity until reconciled; capacity must not be computed from positions alone.

### Entry order

At the same effective timestamp:

1. Process and reconcile exits/reduce-only orders first.
2. Process stock entry intent.
3. Process PENGU entry intent.
4. Process V12 entry intent last.

This selects the tested `STOCK_FIRST` order: `STOCK -> PENGU -> V12`. The latest one-year result was identical under the tested crypto-first and stock-first sequences, but production must still be deterministic.

Priority applies only to simultaneous new entry intents. It does not pre-empt an already-open position. Never force-close or shrink an existing V12, PENGU, V11 or V50 position merely to make room for a later higher-priority entry. The later order receives residual capacity, is reduced below its request, or is skipped. Do not increase it later when capacity becomes available.

### Capacity equations

For a new V12 entry:

`allocatedV12 = min(requestedV12 * 1.00, 1.5 - currentCryptoGross, 2.5 - currentTotalGross)`

For a new PENGU entry, preserve its existing cap against all other Aster positions as well as the combined caps:

`allocatedPengu = min(signalTarget, 0.75, 1.5 - currentCryptoGross, 2.5 - currentTotalGross, 1.5 - otherAsterGrossExcludingPengu)`

For a new stock slot:

`allocatedStock = min(slotCap, 1.5 - currentStockGross, 2.5 - currentTotalGross)`

Then reject the stock entry if the first-stock allocation is below 0.50 or the second-stock allocation is below 0.25. For V12/PENGU, reject when normalized notional is below the exchange or configured USD minimum.

All negative residuals clamp to zero. Equity, notional, symbol classification, positions, open orders, pending orders and reservations must come from one reconciled snapshot under the same shared account-order lock.

### Duplicate and occupied-slot rules

- V12 active: later V12 entry signal is recorded as `V12_SLOT_OCCUPIED` and no order is sent.
- PENGU active: later PENGU signal is recorded as blocked; no add or reversal.
- V11 active: later V11 entry is blocked.
- V50 active: later V50 entry is blocked.
- Same stock symbol selected by V11 and V50: later stock entry is blocked.
- An existing exchange open order or unresolved pending order for the same sleeve blocks a new action.
- An UNKNOWN exchange result enters manual review and blocks further entries; never blind-retry with a new idempotency key.

## Critical integration defects that Codex must resolve

### 1. Current V52 crypto gross classification is incomplete for V12

At VPS-lineage SHA `6f4d06fd990e5e847895b59c4890bb80335ff03e`, `scripts/disdex_v11eq_aster_only_live_engine.py` counts only this hard-coded set in `current_v96_notional()`:

`BTCUSDT`, `ETHUSDT`, `BNBUSDT`, `SOLUSDT`, `PENGUUSDT`.

The V12 universe additionally includes `LINKUSDT`, `AVAXUSDT`, `DOGEUSDT`, `INJUSDT`, `XRPUSDT`, `ADAUSDT`, `LTCUSDT`, `ATOMUSDT`, `AAVEUSDT` and `NEARUSDT`. Adding V12 without fixing classification would let V52 under-count crypto gross and could violate the 1.5/2.5 caps.

Codex must replace the V96-specific accounting with a generic reconciled Aster portfolio classifier, or explicitly include the entire immutable V12 universe plus PENGU. Unknown non-flat Aster symbols must Fail Closed/manual review rather than be omitted.

### 2. Existing runner locks are sleeve-local, not account-global

PENGU uses its own Node file lock and V52 uses its own Python file lock. They can both read the same pre-order account state and submit before either fill becomes visible. A separate V12 service would add a third race.

Codex must implement one cross-language, account-scoped order mutex/reservation protocol used by V52, PENGU and V12 for the entire sequence:

`acquire -> reconcile exchange/state/open orders -> write durable intent/reservation -> recalculate capacity -> persist pending order -> submit -> reconcile/persist result -> release`.

The protocol must use atomic filesystem semantics, owner identity, creation/update timestamps, bounded stale detection and explicit recovery. A stale lock must not be deleted merely because its TTL elapsed while an exchange order may still be pending. Stale ownership first enters reconciliation/manual review.

The existing long-lived per-runner locks may remain for duplicate-process prevention, but they do not replace the account order lock.

### 3. Crypto daily-loss input is optional in the existing PENGU runner

The one-year simulator modeled a conservative 5% crypto daily-loss latch. The deployed PENGU runner consumes the portfolio daily-loss file only when its path is configured. Implementation must provide and require a shared V12+PENGU daily-risk state path in PAPER/LIVE modes and include realized PnL, unrealized PnL, fees and funding. Missing, stale, malformed or strategy-mismatched risk state must block new crypto entries.

Do not weaken the existing PENGU shared-risk flatten or shared kill-switch behavior. The historical simulator mainly blocked entries after realized losses; stricter production flattening can therefore diverge from the backtest and must be explicitly reported in parity/forward documentation rather than hidden.

### 4. V12 production protection does not yet exist

The research simulator models Aster-compatible resident stops, but it is not a production runner. Production requires exchange-side protective-order lifecycle, quantity/tick normalization, partial-fill handling, reconciliation, crash recovery, idempotency, trailing updates and no-unprotected-position proof.

## Shared safety and Fail Closed rules

- Defaults: disabled, SHADOW, no credentials required, no orders.
- LIVE requires independent `enabled`, `liveTradingEnabled` and `liveExecutionEnabled` gates plus exact acknowledgement and immutable runtime SHA.
- Reuse the shared kill-switch path. Do not clear or bypass an active kill switch.
- Reduce-only exits remain allowed when entry capacity is exhausted.
- Unknown position ownership, state/exchange disagreement, duplicate timestamps, invalid candles, non-positive equity, stale account snapshot, gross above cap, unresolved open order, stale reservation, missing risk file or unverified resident stop blocks new entries.
- `closeUnmanagedPositions=false`; unmanaged positions require manual review unless a separately authorized recovery procedure applies.
- Existing V52 reference-quality gates remain unchanged.
- Existing PENGU parameters remain unchanged.
- No environment variable may raise frozen maximum gross or bypass live gates.
- All state writes must be atomic and owner-only; audit logs must record requested gross, allocated gross, capacity snapshot, priority result, blocking reason, idempotency key and exchange reconciliation.
- A process restart must reconcile exchange positions and open orders before evaluating a new signal.

## Required implementation deliverables

Codex may adapt file names to current repository conventions, but the delivered scope must include:

1. A production V12 immutable configuration module with all frozen parameters and `multiplier=1.00`, `entryPolicy=ALL`.
2. A pure V12 signal/sizing/position-state module that can be replayed without order side effects.
3. An Aster V12 market-data provider using completed, continuous H1 data and deterministic H2 resampling.
4. A V12 runner/state store with SHADOW, PAPER and gated LIVE modes.
5. Venue-resident STOP_MARKET creation, update, cancellation and restart reconciliation.
6. A cross-language shared account order lock and durable reservation format.
7. Updates to PENGU and V52 to use the shared order lock/reservations without changing their alpha parameters.
8. Generic Aster position classification covering the full V12 universe, PENGU and five stock perps.
9. A shared V12+PENGU daily-risk state producer/consumer and stale-state rules.
10. Environment templates, package scripts, TypeScript/Python compile configuration and systemd templates defaulting to disabled/SHADOW.
11. Self-tests, parity tests, fault-injection tests and a GitHub Actions workflow.
12. An implementation report stating exact changed files, test output, remaining production divergences and explicit `VPS_UNCHANGED`, `LIVE_NOT_ACTIVATED`, `ORDERS_SENT=0`.

Do not edit the frozen research-result files to make a production test pass. Production parity adapters and test fixtures must point back to the immutable results.

## Acceptance tests

### V12 frozen lineage parity

For `2025-07-01` through `2026-07-01`:

- Normal: 223 trades; return `+110.51703811%` within 0.20 percentage points; PF `3.5104687` within 0.02; PF without best `3.3299211`; max DD about `5.09969101%`; zero liquidation.
- Stress: 179 trades; return `+58.23046005%` within 0.30 percentage points; PF `1.95188492` within 0.03; PF without best `1.85472602`; max DD about `7.83812638%`; 12 deterministic skipped entries.

For the selected latest-year ALL schedule:

- Standalone normal: 219 trades; return `+100.0115%`; PF `3.2655`; max DD about `5.0997%`.
- Standalone stress: 176 trades; return `+49.1286%`; PF `1.8590`; max DD about `7.8381%`; 11 deterministic skipped entries.

### Unified selected-row parity

The research simulator rerun must keep:

- Variant ID exactly `V12_X1.00_ALL`.
- 21 variants in the comparison workflow.
- All lineage/cap checks true.
- Normal and severe priority-order delta `0.0` on the frozen dataset.
- Maximum crypto gross no more than `1.5`.
- Maximum stock gross no more than `1.5`.
- Maximum total gross no more than `2.5`.
- Normal selected-row return/PF/DD within existing deterministic serialization tolerance of `+889.7947479% / 3.30648586 / -12.07387354%`.
- Severe selected-row return/PF/DD within tolerance of `+189.4743864% / 2.15128027 / -16.27200837%`.

### Order-router and failure tests

Tests must prove:

- Same-time exits release capacity before entries.
- Same-time STOCK, PENGU and V12 intents resolve in `STOCK -> PENGU -> V12` order.
- PENGU 0.75 plus stock 1.50 leaves only 0.25 total capacity for a new V12 request.
- Existing positions are not shrunk or pre-empted.
- V12/PENGU/stock requests are scaled or blocked exactly at caps.
- Full V12 universe positions are counted by V52 gross accounting.
- Unknown non-flat symbols Fail Closed.
- Two concurrent processes cannot both reserve the same capacity.
- Crash after reservation, after submit and before result persistence recovers without duplicate order.
- UNKNOWN order result produces manual review and no blind retry.
- Partial entry fill cannot remain unprotected.
- Failed resident-stop replacement leaves the previous acknowledged stop active.
- Restart with position/state mismatch blocks new orders.
- Missing/stale daily-risk file blocks crypto entries.
- Active kill switch prevents entries and is never automatically cleared.
- Reference data over 5000 ms blocks V52 without changing thresholds.
- SHADOW/PAPER tests send no real order and require no plaintext secrets.

Run at minimum the existing PENGU V2 self-test, typecheck and parity commands, the V52 combined contract/self-tests, the new V12 tests, the combined one-year workflow and Linux production build. Any existing failure unrelated to the change must be separated with evidence; do not waive it.

## Implementation completion boundary

This handoff authorizes repository implementation and validation only. It does not authorize:

- VPS login or file mutation;
- immutable release creation;
- service installation, enable, restart or start;
- setting LIVE environment flags or acknowledgements;
- kill-switch release;
- order submission, cancellation or position change;
- migration of current runner state.

The implementation task is complete only after source is pushed to a dedicated implementation branch, relevant CI is green and the report shows `VPS_UNCHANGED`, `LIVE_NOT_ACTIVATED`, `ORDERS_SENT=0`. Deployment and LIVE activation must be requested separately against the exact new 40-character commit SHA.

## Copy-paste task for Codex

```text
Repository: dunamishajime-bit/-ai-dex-manager
Read and follow this contract completely:
docs/implementation/V12_X1_ALL_24H_PENGU_V2_V52_CODEX_HANDOFF_20260817.md

Implement the user-selected V12_X1.00_ALL production-capable source integration with the existing PENGU_DUAL_LS_V2_FINAL and V52 V11_EQ/V50_POST_OPEN_BASIS logic. Preserve all frozen alpha parameters. V96 remains excluded. Implement the shared cross-language account-order lock/reservation, full V12-universe gross accounting, unified crypto daily-risk input and venue-resident V12 stop lifecycle. Default to disabled/SHADOW.

Do not deploy to VPS, do not enable LIVE, do not release the kill switch and do not send/cancel any real order. Work on a dedicated implementation branch, push the exact source and open a Draft PR. Run the full acceptance suite in the handoff. Return branch, 40-character commit SHA, Draft PR, changed files, exact checks, known divergences and the explicit flags VPS_UNCHANGED, LIVE_NOT_ACTIVATED, ORDERS_SENT=0.

If the current default-branch or VPS SHA differs from the recorded lineage, preserve newer work, report the divergence and adapt safely. Do not weaken any reference-quality or risk gate and do not retune V12, PENGU, V11 or V50 to make tests pass.
```

