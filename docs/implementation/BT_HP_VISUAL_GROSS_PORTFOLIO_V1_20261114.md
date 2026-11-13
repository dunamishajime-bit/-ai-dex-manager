# BT visual Gross and portfolio — 2026-11-14

Status: UI_MVP_LOCAL / NOT_DEPLOYED / CANONICAL_BT_NOT_CONNECTED

Owner-approved: B main = actual Gross x usage; A auxiliary = percentage of explicitly named cap.

## Display and replay rules

- Gross is absolute exposure, NOT net exposure. Position Gross = absolute position notional / canonical equity allocation base at event time.
- Total, Crypto, Stock meters display x used / x cap prominently, and % next to it. Historical cap defaults Total 3.50x, Crypto 3.00x, Stock 1.50x are DEMO ONLY; replay must use exact historical risk limits.
- Positions each show logic, symbol, direction, quantity, entry, mark, notional, unrealized PnL, absolute Gross and fraction of Total cap.
- Portfolio positions, Gross meters, equity and BTC representative chart must always share the exact simulated timestamp.
- Entry/exit markers must show actual traded symbol, not falsely imply every event is BTC.
- On accepted or rejected order and on each partial fill or exit, persist portfolio-before/after, Gross-before/after, risk checks, pending/reserved exposure, capacity blockage and order evidence.
- The canonical BT execution engine, not the HP, must decide signals/fills/risk. No HP-only economic logic or invented fills.
- Mode separation REAL_DATA versus SYNTHETIC is mandatory, with synthetic seed and data SHA captured.
- Preserve replay data and manifest including logic pins, engine SHA, data hashes, period, fee/funding models and every event, and allow JSON/CSV/ZIP and PDF exports to Codex/GPT.
- No production order, STOP, position, Kill Switch or runner modification is ever allowed from this page.

## Current scope

The new route app/bt-verification/page.tsx contains an isolated illustrative UI MVP: time controls, BTC path, equity curve, live position table, Total/Crypto/Stock Gross stacked meters, per-position cap share, logic/symbol filtering, JSON import/export and CSV timelines.

NOT YET BUILT: canonical BT adapter, authenticated durable storage, ZIP/PDF, reference-source consistency checks, formal QA, menu navigation, deployment. The sample numbers must never be interpreted as real BT results.
