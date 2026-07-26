# Aster-only V17 July Untouched Holdout Protocol

## Purpose

Evaluate exactly three frozen Aster-only representatives on sessions after the V14/V15/V16 selection period. No new parameter is selected from July outcomes.

## Holdout window

- selection and tournament window ends: 2026-07-01 exclusive;
- untouched diagnostic starts: 2026-07-01 inclusive;
- available frozen data ends: 2026-07-23 exclusive;
- expected maximum: approximately 15 U.S. sessions.

The data source commits already define 2026-07-23 as their end and were not changed to obtain the July result. V14/V15/V16 explicitly filtered their selection period to 2026-07-01 exclusive.

## Frozen candidates

Exactly these three candidates are evaluated:

1. V14 single-position residual candidate: `ZSCORE_RESIDUAL_FADE__T2.5__H3__NONE`;
2. V15 short-horizon candidate: `TIME_SLOT_ZSCORE_FADE__T2__SLOT_1230__H2__NONE`;
3. V16 same-Aster pair: `ZSCORE_PAIR__T3__SLOT_1130__H2__CONVERGENCE_50`.

No threshold, holding period, time slot, cooldown, exit or family may be altered after July results are observed. The three candidates are reported individually. The best July candidate is not selected as a new Production winner.

## Historical state

Rolling 20-session means and standard deviations are built chronologically using all sessions before each decision, including pre-July history. July outcomes are never used to create features for an earlier July decision.

## Cost scenarios

- Forward median: 24 bps round trip;
- Normal: 40 bps;
- P95: 44 bps;
- Severe: 100 bps and fail closed above the 60 bps observable-cost limit.

## Short-window evidence threshold

A frozen candidate is classified as a positive July signal only when all are true:

- at least three accepted Normal trades/pairs;
- Normal compounded return is positive;
- P95 compounded return is positive;
- Normal Profit Factor exceeds 1.10;
- Normal maximum drawdown is no worse than -2.0%;
- Normal net bps per Aster capital-hour exceeds the frozen two-venue V13D Normal value of approximately 2.97 bps/hour;
- Severe remains non-negative through fail-closed behavior.

This threshold identifies a Forward-Shadow lead only. Fifteen sessions cannot authorize Production or establish expected future profitability.

## Safety

Research only. No Production, LIVE, VPS, systemd, credentials, orders, positions, Crypto V96, V11-EQ or V13D changes.
