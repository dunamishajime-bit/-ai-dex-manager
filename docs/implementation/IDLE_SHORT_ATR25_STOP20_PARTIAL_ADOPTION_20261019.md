# Idle SHORT — ATR2.5 + 20% basket STOP + residual sizing, adopted implementation candidate (2026-10-19)

**Decision:** ACCEPTED FOR IMPLEMENTATION TRACK / research branch only. This does **not** authorize LIVE activation, operator approval, daily-risk reset, bypass of any existing gate, or modifying resident STOP.

## Selected baseline

- Keep IDLE_PRIORITY_SHORT signal routes, current 12h/24h fixed exit, 10% emergency STOP, 25% emergency take-profit, and recovery behavior unchanged.
- Enforce ATR ratio <= 0.025 from the same causal H1 feature stream, immediately before admission (do not rewrite the original 495/61 historical anchor).
- Enforce a shared-account **total SHORT worst-case STOP loss budget** of <=20% of **current signed equity**, using current exchange mark price to verified resident STOP, adding a 2% adverse STOP execution-gap stress and conservative roundtrip 10bps. Cross-runner shorts must be included, not merely Idle-owned shorts.
- Count all complete/fresh pending order reservations under the same account lock.
- Use min(requestedIdleGross, cryptoAndTotalRoom, remainingBasketRiskRoom) with strictly downward rounded exchange quantity; research minimum size 0.25x, but real venue minQty/stepSize/minNotional take precedence. If below floor reject, do not enlarge quantity.
- Reduce-only resident STOP signed readback (quantity, stop price, side, verified freshness) is mandatory for any existing SHORT. A floating winner with an unprotected or stale STOP cannot contribute negative risk credit.
- No one-per-H1 veto; sequential, deterministic candidate ranking and rechecks across pending order reservations required.
- **Do not adopt** blanket Gross<=1.5x, blanket profit-lock STOP (6% favorable then 2.5% guaranteed), blind early exit, or relaxed Shared Risk kill switch.

## Reproduced historical comparisons

The old five-runner 1284-event accepted-intent replay (not current V12 V4 or October exit overlay) at 10bps and 2% basket adverse gap:

- Full order reject at budget: JPY 203,632,942; 54 Idle trades; integrated DD -22.8191%.
- **Residual partial sizing, no profit lock:** JPY 208,386,196; 56 Idle trades; integrated DD -22.8191%.
- Profit lock added: JPY 205,119,508; 57 Idle trades; integrated DD -22.8191%.

At gap 0% and 1% the partial-sizing option also beat both alternatives, including profit lock, on integrated final JPY. These are **research simulation results** based on frozen intents; do not label as a fully certified production integration or current-LIVE results.

The 61 original Idle H1 entry/exit price returns exactly reconciled to archived Aster H1 candles, and 30 Python regression tests previously passed.

## Executable code

- lib/idle-priority-short-basket-adopted.ts: pure deterministic research contract evaluateIdleShortBasketCandidate and immutable candidate constants. Requires signed STOP readback / lock-held / complete exposure / fresh pending.
- scripts/idle-priority-short-basket-adopted-selftest.mjs: 10 independent tests (ATR boundary, 20% risk, partial sizing, stale STOP failure, pending risk, protected-profit semantics, step rounding, account lock, exchange minimum).

Test: node --experimental-strip-types scripts/idle-priority-short-basket-adopted-selftest.mjs

## Still required before LIVE

This helper is **intentionally NOT wired into** lib/idle-priority-short-runner.ts; that runner currently has strict baselineOpenPositions==0, full gross available, and existing admission/parity certificate contracts that must not be silently bypassed. A source-only import or direct config change would invalidate original parity without actually certifying a new strategy.

A later runtime integration must be developed and tested against the **current** deployed SHA (not this research branch), actual cross-Runner protective STOP orders and owner readbacks, pending registry and global account lock, correct reset-safe reservations, adverse market gaps, venue min quantity/notional, operator artifact, current ATR causal H1, margin guard and current risk latch. CI on the current release/certification must pass. Preserve rollbacks.

This is a selected **candidate for implementation**, not a confirmed deployed adoption.

## LONG workstream

Separate investigation based on the frozen DD1296 1,358-accepted-trade ledger and causal Aster H1 data; do not modify PENGU exit configuration. New independent evidence/report will accompany a later research commit.
