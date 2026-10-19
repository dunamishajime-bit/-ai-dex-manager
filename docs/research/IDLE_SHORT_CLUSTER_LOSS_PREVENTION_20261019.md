# Idle SHORT cluster-loss forensic audit and BT change contract — 2026-10-19

STATUS: RESEARCH ONLY / NO LIVE ORDERS / NO PRODUCTION GATE CHANGES
Reference common Production SHA: `dd87161165330310df39dd644aa35cd8a6eca6a4`.
This document is not operator authorization and does not grant permission to reset Shared Risk or liquidate positions.

## Independently observed evidence (journal and current source)

**2026-10-19 JST**:
- 01:17:52 JUPUSDT Idle SHORT entry completed (2026-10-18T16:17:52Z, source release `89a2bdb...`).
- 05:00 confirmed H1 decision timestamp `1792353600000`.
- 05:26:40 Idle SHORT emitted `IDLE_MULTI_SIGNAL_PROCESSED:1792353600000` with `ordersSent=2`, result symbol TIAUSDT (source `486091bc...`). Account later held TAOUSDT -0.241, TIAUSDT -103, JUPUSDT -22. Attribution of the exact two new fills must still be independently reconciled from signed exchange trades.
- Shared Risk before the multi-signal entry, at 05:26:04 JST, recorded portfolio unrealized PnL **+0.055 USDT** and realized PnL 0, fees -0.00246664, funding -0.0009316. Therefore a simple 'earlier short was already losing' rule would **not** necessarily have vetoed this event.
- At 05:27:09, portfolio unrealized PnL was **-0.08629329 USDT**, fees -0.05165439; the multi-entry increased exposure and fees. Do not interpret this as the full later loss.
- Signed venue read-only check subsequently confirmed positions TAOUSDT SHORT -0.241 at entry 256.08, JUPUSDT SHORT -22 at entry 0.2803, TIAUSDT SHORT -103 at entry 0.5947, each with matching reduceOnly STOP_MARKET and TAKE_PROFIT_MARKET quantities and status NEW (this is a snapshot; ownership/fill lineage must be cross-verified).
- Historical Idle baseline selected 61 trades, 48 wins, 13 losses (78.7%), per `docs/superpowers/specs/2026-09-29-idle-priority-bt-parity-design.md`. Avoid turning a strong historical sleeve into a trivial, overfiltered strategy.

### Confirmed source-level admission gaps

In `lib/idle-priority-short-runner.ts`:
- `enter()` checks shared health, baseline strategy inactivity, gross room, same-symbol ownership, pending etc., **but does not gate an additional Idle SHORT on already-owned SHORT unrealized loss, existing SHORT protected-profit floor, or total expected losses at all resident STOP levels**.
- At the multi-signal block, lines approximately 831-860, if total requested gross fits, the loop sequentially calls `enter()` for every signal in the same H1 decision. No deterministic one-per-H1 SHORT-basket gate is enforced.
- A completed H1 signal of 05:00 was executed in a tick at 05:26. Quantify elapsed decision-to-actual-entry interval and intrabar price reversal. `quoteFresh` verifies quote freshness, not how stale the original H1 direction is.
- `config/idlePriorityShortPolicy.ts` requests 1.0 gross each for TAO, TIA, JUP (DOT/RENDER use 0.25); `lib/idle-priority-short-live.ts` sets 10% price hard STOP and 25% TP. TAO and TIA together can each contribute approximately 10% of account equity in loss at their individual STOPs when both sized 1x (before slippage and costs), even though the 7.5% daily-loss flag merely prevents **new** entries.

## Research variants to benchmark against original baseline

A. Underwater-only: forbid adding another Idle SHORT if **any existing same-direction Idle SHORT** has negative current unrealized PnL after fees. Alternative: aggregate same-side Idle PnL negative. Requires fresh signed quantity and mark/quote; stale data blocks entry, never protective exit.

B. Profit buffer/locked-profit pyramiding: test requiring total existing Idle SHORT PnL >= 0%, +0.5%, +1.0% account equity AND current venue STOP protection on earlier positions tightened sufficiently that losses at STOP will not negate the buffer. Contrast 'floating profit' vs 'guaranteed nonnegative stop price' admission. A mere +0.055 USDT floating profit is not meaningful protection against two new full-size correlated shorts.

C. Simultaneous H1 signals: max **one new Idle SHORT per decisionTs**. In case of TAO/TIA simultaneous candidates, deterministically select by ex-ante OOS-ranked expected value, stable source features, or lowest risk budget. Never select using future realized PnL. Test max 1 vs max 2, 30/60/120-minute portfolio cooldown after entry.

D. Short-basket budget: test same-side Idle gross caps 1.0/1.5/2.0/3.0 and separately **STOP-loss-at-risk budget** (sum over signed venue positions of abs(qty) * distance-to-resident-STOP / fresh equity) with stress adders/slippage, e.g. 5%, 7.5%, 10% wallet equity. A global daily new-entry latch is **not** a substitute for worst-case open-risk prevention. Respect Aster step size and min notional: do not send tiny invalid quantities or silently change 1x sizing without declaring a different strategy.

E. Entry-timing/late SHORT reversal veto: test H1 decision age windows 5/10/15/30/45min; validate against actual quote / completed 5m trend reversals and ATR/relative BTC regime. Missing/stale data fail closed. Include actual API-rate-budget delays so BT does not assume immediate fills that LIVE missed.

F. Optional profit-defense: evaluate resident basket or symbol profit-protection and trailing STOP only if it improves out-of-sample PnL/DD; do not loosen or cancel existing resident STOP before a replacement is placed and verified.

Evaluate standalone and joint combinations; do not simply stack every veto and call the reduced trade count better.

## Shared Risk redesign: distinguish different risks

Current `lib/disdex-shared-crypto-risk-writer.ts` computes:
`referenceEquity = walletBalance - (realizedToday + feesToday + fundingToday)`,
`netDailyPnl = realizedToday + feesToday + fundingToday + currentFullUnrealizedPnl`,
`lossPct = max(0, -netDailyPnl/referenceEquity*100)`;
same-day `tripped` is latched.

This includes **all unrealized loss carried from before UTC midnight**, rather than strictly the movement since UTC midnight. For a true 'today PnL' metric research a durable UTC-00 position mark/unrealized baseline, realized trades, fees, funding and external cashflows. Keep separate:
1. Daily realized/mark-to-market incremental loss latch (entry block).
2. Absolute current equity drawdown / open-position STOP-at-risk basket guard (entry block).
3. Global high-risk emergency response and existing reduceOnly exit continuity, separately authorized.

Do not reset today's tripped status simply by changing code, subtracting carried loss, editing a json state, or increasing 7.5%. Define migration/reconciliation plus explicit operator approval. Historical liabilities must remain visible. Reconcile against signed venue margin/account PnL, open positions, UTC rollover records and cash flows.

## Acceptance before any LIVE implementation

- Exact independent trade timestamps, quantities, ownership, prior same-side unrealized PnL at **each** entry, BTC and symbol 5m/1h price path at entry, signal age, and worst-case STOP exposure.
- Historical fixed candidates (63->61), 10/20/30bps costs, standalone/integrated event counts, wins/losses, PnL, PF, worst DD, missed winners, risk accumulation, daily pauses; no future candle.
- Walk-forward and untouched recent OOS since 2026-08-10 where data exists; use LIVE-style latency and order rounding.
- Automated regression: profitable existing position but unprotected at its STOP; underwater existing short; simultaneous TAO+TIA; stale mark and STOP; competing peer position; shared risk tripped; manual-review entry; partial fill/STOP replacement.
- Deployment only with separately authorized exact SHA, completed CI and account/protective-STOP read-back. The current three live positions and six protective orders must remain untouched by this **research**.
