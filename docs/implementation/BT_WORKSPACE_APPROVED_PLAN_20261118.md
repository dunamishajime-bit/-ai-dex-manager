# DisDex BT Workspace — owner-approved implementation ledger (2026-11-18)

Status: SPECIFICATION APPROVED; IMPLEMENTATION PENDING. Source of truth for future work. This document does not certify a backtest or authorize LIVE trading changes.

## Invariants
- BT workspace is authenticated and read-only relative to live trading: never place/cancel orders, change positions/STOP, Runner state, or Kill Switch.
- Keep existing HP design/navigation and independent BT sidebar.
- Strategy selection uses pinned production implementation and exact entry/exit, STOP, priority, Shared Risk and Gross logic. Never label a name-only mock as production-equivalent.
- Preserve provenance (runner SHA, dataset hashes, transaction ledger, seed, settings). Flag gaps, source mismatch, unresolved signals.
- Distinguish candidate signal, approval, rejection, virtual fill and exit. Per-symbol chart shows only that symbol's events; BTC/USDT overview shows time-aligned fills for all strategies/symbols without mapping their prices onto BTC.

## Task checklist
- [ ] BT-01: Select synthetic chart vs historical baseline.
- [ ] BT-02: Current strategy selector with individual ON/OFF and associated symbol list.
- [ ] BT-03: Pinned strategy execution parity (entry, exit, STOP, risk, gross, priority).
- [ ] BT-04: Connect existing downloaded historical bars and reusable BT ledgers; verify integrity and missing data.
- [ ] BT-05: Select synthetic start/end; end must be no later than yesterday in Asia/Tokyo.
- [ ] BT-06: For each symbol use actual previous-day close as synthetic end-date close, generate seeded OHLC backwards, replay forward with no future-bar/anchor leakage.
- [ ] BT-07: Chart per selected trading pair, with own events only.
- [ ] BT-08: BTC/USDT representative chart with all fills aligned by event timestamp.
- [ ] BT-09: Separate candidate/approved/rejected/fill/exit visual markers.
- [ ] BT-10: Editable initial JPY capital, default 10,000.
- [ ] BT-11: Compound/simple position sizing; cash/risk constraints always apply.
- [ ] BT-12: Contributions ON/OFF, amount, weekly/monthly frequency, payment day.
- [ ] BT-13: Cash-flow-separated deposits, realized PnL, equity, DD, gross; recalculate fills when capital changes.
- [ ] BT-14: Synchronized start/pause/speed/seek across charts and portfolio.
- [ ] BT-15: Controlled same-data/same-seed comparisons and wrong-direction analysis.
- [ ] BT-16: Save/export configuration, seed, SHA, evidence, fills, metrics as CSV/JSON.
- [ ] BT-17: Auth, responsive UI, automated tests/CI, owner-approved HP-only production deployment.

## Baseline BT
Use already acquired market data and ledgers for UTC [2025-10-01 00:00, 2026-10-01 00:00), end exclusive; default initial capital JPY 10,000; independently model 10bps and 30bps. HYPE and IDLE are hypothetically enabled as previously specified, and must be labeled. Do not assert exact production parity until evidence validates pinned runner, coverage and fill reproduction.

## Synthetic anchoring example
On 2026-11-18, selected period 2026-01-01..2026-08-31: each symbol's simulated 2026-08-31 final close equals its real 2026-11-17 close. Seeded random correlated OHLC history is constructed backwards, then replayed chronologically from January. Actual anchor must be sourced, not invented; if unavailable, show a data error. Do not expose later candles or terminal anchor to a running strategy.

## Finance and reporting
Compound uses realized equity for future sizing. Simple uses fixed principal plus defined contributions for sizing without compounding gains, while available cash and all risk limits remain binding. Contributions are external deposits, not trading returns; show net deposits and trading PnL separately. Preserve a reproducible configuration snapshot.

## Delivery sequence
Phase 1: BT-01/02/05/07/08/10/11/12 UI and validation.
Phase 2: BT-03/04/06 data, execution parity and synthetic generator.
Phase 3: BT-09/13/14 events, synchronized playback and accounting.
Phase 4: BT-15/16 comparison and export.
Phase 5: BT-17 regression, CI, review and formal owner-approved deployment.
Each phase: isolated changes, tests, commit, push, PR, evidence; do not deploy to production without formal approval.
