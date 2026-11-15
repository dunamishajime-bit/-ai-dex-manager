# BT PR #481 — V52 AMZN SHORT: isolate original pure Yahoo reference-price gate

Date: 2026-11-15. Scope: isolated BT worktree only, read-only source reference. No LIVE or Codex branch, VPS, order, STOP, authentication or GitHub master changes.

## Source verification

The reference checkout is `C:\tmp\disdex-stable4-impl-20261114` at `9118eeaa6c209dc6e37887cf5be139b3baaa005d`.

The upstream source is `scripts/dd-reduction/v52_amzn_yahoo_gate.py`, SHA256 `a460ec08d3b9d5dfc5df0d43edb41e54a37e6fc280af8ebf9f8a20ab4821e920`. It contains both pure logic and external Yahoo HTTP requests.

For the BT research workspace, `lib/bt-verification/pinned-native-v52/amzn_yahoo_gate_pure.py` contains **13 source-identical function bodies** for the AMZN SHORT session, previous-session price, +1% strict threshold, age, missing data and source-causality checks. Import helpers are standard-library-only; the Yahoo HTTP/fetch functions and all live engine, order, and STOP code are excluded. `source-manifest.json` records the original SHA and each upstream function-body SHA. The test compares each extract after only Windows CRLF restoration; **the original decision function is not rewritten**.

## Verified tests

`scripts/bt-hp-v52-amzn-yahoo-source-selftest.py` checks: exact +1% daily return PASS, strictly greater than +1% BLOCK, future/incomplete bars rejected, missing current/previous NYSE session fails closed, holiday/weekend prior-session lookup, and no live/network imports. The source-manifest hash checks pass. Number of simulated orders and modeled V52 trades: **0**.

This is a **narrow original source gate verification**, not a standalone V52 stock strategy engine. The V52 V50 basis entry is defined in `scripts/disdex_v52_aster_only_legacy_engine.py` and requires the original Aster and independent stock reference quote, separate source receipt timestamps, VWAP/slippage, current positions, capital, spread/depth, NY session, rolling captured signal basis and AMZN Yahoo gate. One invented stock OHLCV feed cannot substitute for this multi-source pipeline.

## Next proof obligations

- Add an explicit, isolated input contract for two independent modeled sources (Aster and reference) including realistic synthetic basis/age/depth/spread and strict provenance. An invented basis difference must remain labeled as such and cannot demonstrate profit or production parity.
- Isolate the native V50 candidate comparison without inheriting live engine side effects such as `self.save()`, `aster.place_limit`, quote fetch, kill switch, or state mutation. Assert causal source equivalence with source-backed test vectors.
- Model all-runner slot/gross/admission and exits only after native strategy and controlled data requirements are met.
- Avoid certified/live parity labels until complete current production pin evidence and independent verification exist.

No return, win rate or full 7-runner result is asserted by this task.
