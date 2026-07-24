# V96 Stock V13 Edge-Floor and Diversification Protocol — 2026-07-24

## Purpose

Continue the no-lookahead V13 profit-pursuit result by addressing its two remaining weaknesses:

1. full-period Forced Severe remained negative at the original 12 bps floor;
2. META contributed more than 40% of positive Normal profit.

The experiment tests only two predeclared levers: a stronger minimum Aster/XYZ dislocation and a simple repeat-symbol diversification rule.

## Evidence classification

This is reused historical exploratory evidence.

- The underlying 74-session history was already inspected by V12/V12B, the holding-duration study and the first profit-pursuit tournament.
- Development performs the candidate selection; Validation and the final chronological segment are reported.
- No independent-Holdout claim is made.
- No nearby edge floor may be added after this run.

## Frozen parent logic

All candidates inherit the first no-lookahead profit-pursuit structure:

- Aster Maker with opposite XYZ Taker hedge;
- AMZN, META, MSFT, NVDA and TSLA;
- synchronized 30-minute candles and actual Funding histories;
- exactly 10:00 New York entry only;
- Aster discount BUY or Aster premium SELL;
- choose the largest absolute dislocation only among symbols available at the same 10:00 timestamp;
- one portfolio position total;
- no same-day future opportunity may influence the choice;
- target exit at 15:00 New York;
- at the completed 14:00 bar, pair price PnL of at least 30 bps exits at 14:30;
- no overnight inventory;
- 100 USD initial virtual notional.

## Fixed edge floors

- 12 bps — parent control;
- 15 bps — moderate quality filter;
- 20 bps — strong quality filter.

The exact values are declared together. Testing 18, 22, 25 or nearby values after seeing this result is prohibited on the same history.

## Fixed diversification modes

- `NONE` — select the largest simultaneous eligible spread without a symbol cooldown;
- `NO_PREVIOUS_SYMBOL` — the symbol used by the immediately preceding completed trade is ineligible for the next trade.

The diversification rule uses only completed past trades. It does not use future profit, future opportunity or a symbol blacklist learned from the final segment.

## Selection

Development independently selects:

- the Growth arm from candidates with diversification `NONE`;
- the Diversified arm from candidates with `NO_PREVIOUS_SYMBOL`.

A Development candidate must have at least five cycles and positive average Forced Normal, P95 and Severe results.

The chosen arms are then reported on Validation, the final chronological segment and the full period. A minimum of four cycles is required when interpreting Validation or the final segment.

## Costs

Primary complete-cycle scoring:

| Scenario | Forced-Taker cost |
| --- | ---: |
| Forward median | 10 bps |
| Normal | 16 bps |
| P95 | 26 bps |
| Severe | 45 bps |

Two-Maker 6 / 10 / 17 / 30 bps results are sensitivity only because historical candles cannot prove a second Maker fill.

## Required reporting

For every candidate and both selected arms:

- Development, Validation, final chronological segment and full results;
- cycles, sessions, average net bps, win rate and profit factor;
- Normal compounded return and maximum drawdown;
- symbol counts and positive-profit contribution concentration;
- best-trade and best-month removal for the Growth arm;
- Forced-Taker and Two-Maker scenarios.

## Promotion boundary

A historical winner can only become a frozen Forward/Shadow arm.

Production or LIVE remains prohibited until untouched Forward evidence confirms actual queue consumption, complete Maker fills, partial-fill safety, 250 ms hedge reliability, second-Maker feasibility, Normal/P95/Severe profitability and acceptable symbol concentration.

## Safety

- Research only
- Order submission disabled
- Production unchanged
- LIVE unchanged
- VPS unchanged
- Crypto V96 unchanged
- V11 unchanged
- Existing V13 Forward collector unchanged
