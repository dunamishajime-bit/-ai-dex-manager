# BT PR #481 — Artificial two-source V52 V50 time-path evaluation with the exact source method

Date: 2026-11-15 JST. Branch `feat/bt-visual-gross-20261114`. Pure, offline work only; no LIVE, Codex, VPS, real account, positions, STOP or actual orders.

## Grounded native strategy requirements

The original `V52AsterOnlyEngine.v50_candidate()` method was SHA-pinned and extracted verbatim in the preceding commit. It uses Aster book mid/bid/ask, independent reference quote, captured pre-entry basis snapshot, fee/slippage estimate, depth, spread, both source receipts, active positions and gross telemetry. It selects by strongest absolute basis among the eligible symbols. A separate Yahoo confirmed-H1 gate applies only to AMZN SHORT.

The upstream V52 V50 policy `V50_B60_C20_STOP1.75_EDGE7.5_COST60_SPREAD20` schedules 11:30, 12:30 and 13:30 New York time. It captures a basis in the final 10 seconds before a window, then evaluates within 20 seconds after the window. The five source-symbols in `scripts/disdex_v13d_v11eq_stock_live_engine.py` are AMZN, META, MSFT, NVDA and TSLA.

## Research input generator

`scripts/bt-hp-v52-dual-source-synthetic-input.ts` creates a reproducible, versioned, two-quote-source **fictional** time path, using the existing 23-symbol synthetic feed v1 as its stock 5-minute reference anchor. It generates separate Aster-side book mid/bid/ask/spread/depth/fee and stock reference microprice observations at 11:29:55 and 11:30:05 NY time (also 12:29:55 / 12:30:05 and 13:29:55 / 13:30:05). All microquote changes are sampled sequentially using a distinct fixed random seed as of those generated micro-observation times; no next 5-minute candle is read. Source receipt timestamps are explicit and precede each corresponding decision.

**Important limitations:** Both "reference" and "Aster" prices are invented by this test model, not independently observed from real providers. There is no empirical basis calibration, NYSE holiday calendar, market-depth distribution calibration, guaranteed source refresh, account data or real per-venue microstructure. The simulated entry time is a fixture, not a native LIVE clock. No event is a financial-performance result.

## Original code regression

`scripts/bt-hp-v52-dual-source-temporal-selftest.py` consumes the generated data, pins original V50 method SHA and executes that **unaltered native method body** inside a fixture shell. The shell mocks only book/reference inputs, time/fees, no-op `save()` and `log()`, and an empty confirmed Yahoo bar set for AMZN SHORT (fail closed). It does not inherit from or import the full live engine, place, cancel or close any orders.

Seed 20261115, scenario rotation, 2025-10-01 through 2025-10-18 UTC:
- NY weekdays observed: 13; entry windows: 39 (13 per 11:30/12:30/13:30); 195 native per-symbol comparison rows.
- Source-side eligible rows before slot/risk/portfolio admission: 54.
- Original method selected **31 candidate windows**, not 31 trades. The decisions are not position-occupied or daily-cap constrained because the test shell deliberately has no strategy position lifecycle.
- Rejection counts by source flag: `BASIS_BELOW_60` 123, `NET_EDGE_BELOW_7_5` 97, `DEPTH_BELOW_2X` 20, `AMZN_SHORT_YAHOO_REFERENCE_DATA_UNAVAILABLE` 19, `SIGN_CHANGED` 2. Multiple flags can apply to the same row.
- Trace SHA256: `e62631e2ca22a5f50a66c466db8d2015d4cde6b5b144b5978889b4a8ea3156b9` for this exact seed/scenario, direct UTF-8 stdout JSON with no PowerShell-added newline.
- Quantity/entry fill, payout/PnL, fee/funding actually charged, realized Gross, real position and actual LIVE result: **0 or unavailable**. No V52 or integrated portfolio parity claim.

The test validates microquote receipt timestamps are before decisions, native stock universe is exactly five symbols, all schedule windows match, quotes/age/depth are valid input shapes, and no future bar/next-tick leakage is used for the modeled quote pair. The preceding task separately validates strict original V50 gates with engineered positive/negative boundaries.

## Integration still pending

Use this source-backed pair trace as a *research candidate-only* source for authenticated BT workspace reporting after a dedicated isolated server job interface is reviewed. A whole V52 simulated trade needs the actual V50 original capture, NYSE dates, true two-source quotes, execution price, min-fill-ratio, checkpoint exits, V11/V50 conflict, AMZN reference history and shared risk/gross/admission. Full seven-runner STABLE4_OPPORTUNITY with 10/30bps and production caps is separately unproven. Never display these native candidates as fills or profit.
