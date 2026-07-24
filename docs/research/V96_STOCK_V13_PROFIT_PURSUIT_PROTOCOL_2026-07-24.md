# V96 Stock V13 Profit-Pursuit Historical Protocol — 2026-07-24

## Purpose

Continue the V13 historical work after the user correctly identified that the original 60-second inventory limit was too short.

This experiment pursues more profit without using an invalid same-day hindsight selector. A candidate may rank only symbols that are simultaneously available at the same timestamp. Future opportunities from later in the same day are never used to choose an earlier entry.

## Evidence classification

This is reused historical research, not an untouched Holdout.

- The 74-session Aster/XYZ history was already inspected by V12/V12B and the duration study.
- The final chronological segment is evaluated once inside this workflow, but no independent-Holdout claim is made.
- The purpose is to freeze a stronger Forward-only candidate before untouched execution evidence is collected.

## Fixed market and execution proxy

- Aster Maker versus XYZ Taker hedge
- AMZN, META, MSFT, NVDA and TSLA
- synchronized 30-minute public candles
- actual public Funding histories from both venues
- fixed 12 bps entry dislocation
- strict next-bar-open Maker-fill proxy
- 100 USD initial virtual notional
- one Stock position total
- no overnight inventory
- entry cutoff 10:30 New York

Historical candles cannot reconstruct queue priority, cancellations ahead, aggressor direction, partial fills, exact bid/ask or the frozen 250 ms hedge path.

## No-lookahead portfolio selection

At each completed 30-minute decision timestamp:

1. evaluate only symbols available at that exact timestamp;
2. apply the fixed entry-direction rule;
3. choose the largest absolute Aster/XYZ dislocation among those simultaneous candidates;
4. open at most one portfolio position;
5. ignore later signals until that position is closed.

No candidate is selected using the best opportunity observed later in the same day.

## Development entry tournament

The target exit remains fixed at 15:00 New York while Development compares:

- `BOTH`: Aster discount and premium directions through 10:30;
- `ASYMMETRIC`: Aster discount BUY at 10:00 or 10:30, while Aster premium SELL is accepted only at 10:00;
- `BUY_ONLY`: Aster discount BUY only.

A Development candidate requires at least ten cycles and positive Forced Normal and P95 average net results.

## Validation exit tournament

Only the Development-selected entry structure proceeds to these fixed exit choices:

- `FIXED_1500`: close at 15:00;
- `LATE_TP30`: at the completed 14:00 bar, if pair price PnL is at least 30 bps, close at 14:30; otherwise 15:00;
- `LATE_HALF_CONVERGENCE`: close at 14:30 if at least half the entry dislocation has converged;
- `LATE_ZERO_OR_6`: close at 14:30 if the spread crosses zero or reaches 6 bps absolute;
- `LATE_ANY_PROFIT`: close at 14:30 if pair price PnL is positive.

Validation selection requires at least five cycles and positive Forced Normal and P95 average net results. The selected rule is then evaluated once on the final chronological segment.

## Cost envelopes

Primary complete-cycle scoring uses the V13 forced-Taker envelopes:

| Scenario | Cost |
| --- | ---: |
| Forward median | 10 bps |
| Normal | 16 bps |
| P95 | 26 bps |
| Severe | 45 bps |

The lower two-Maker envelopes of 6 / 10 / 17 / 30 bps are reported only as sensitivity because a second historical Maker fill cannot be proven from candles.

## Required reporting

- Development, Validation, final chronological segment and full-period metrics;
- cycle and session counts;
- average net bps, positive rate and profit factor;
- Normal portfolio compounded return and maximum drawdown;
- symbol contribution and positive-profit concentration;
- best-trade and best-month removal;
- forced-Taker and two-Maker cost results;
- exact safety flags and limitations.

## Promotion boundary

A positive historical result can authorize only a separately frozen Forward/Shadow arm. It cannot authorize Production or LIVE.

Untouched Forward evidence must still establish:

- actual queue consumption and complete Maker fills;
- zero unresolved partial fills;
- reliable 250 ms hedge execution;
- second-Maker close feasibility;
- positive Normal, P95 and Severe results;
- acceptable symbol concentration;
- no post-window retuning.

## Safety

- Research only
- Order submission disabled
- Production unchanged
- LIVE unchanged
- VPS unchanged
- Crypto V96 unchanged
- V11 unchanged
- Existing V13 Forward collector unchanged
