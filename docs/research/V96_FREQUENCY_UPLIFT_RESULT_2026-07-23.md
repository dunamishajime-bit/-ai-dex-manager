# V96 Frequency Uplift Research Result — 2026-07-23

## Status

**HISTORICAL_PASSING_CLUSTER_FOUND_SHADOW_ONLY**

This research addressed the concern that V96 order frequency is too low to realize sufficient profit opportunities.

No Production, LIVE, VPS, runtime configuration, current V96 allocation, or orders were changed.

## Current baseline

- Core component volume floor: `0.70`
- Weight Band tolerance: `5%`
- Portfolio rebalance threshold: `20%`
- Forced refresh: `12` completed 12-hour bars
- Historical Core target/rebalance events: `275`
- Full Normal return: `+343.7621%`
- Full Severe return: `+41.0068%`
- Maximum drawdown: `-30.7176%`
- Reused 2026H1 Normal / Severe: `+6.2177% / -5.3217%`

## Passing historical cluster

Four neighboring candidates increased target/rebalance frequency by at least 20% while beating the current V96 Core in Full Normal, Full Severe and reused 2026H1 results.

| Candidate | Volume floor | Portfolio threshold | Events | Increase | Full | Severe | DD | 2026H1 | 2026H1 Severe |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| V50_P075 | 0.50 | 7.5% | 351 | +27.64% | +394.9737% | +86.9596% | -30.2022% | +11.9909% | +1.7720% |
| V50_P100 | 0.50 | 10.0% | 343 | +24.73% | +387.4371% | +81.2356% | -30.2022% | +11.8918% | +1.7172% |
| V55_P075 | 0.55 | 7.5% | 347 | +26.18% | +385.2799% | +74.9682% | -28.0153% | +12.3558% | +1.9574% |
| V55_P100 | 0.55 | 10.0% | 340 | +23.64% | +387.8854% | +74.3163% | -28.0153% | +12.2565% | +1.9025% |

All four retained positive Normal returns in 2023, 2024, 2025 and reused 2026H1. All four remained positive under Severe after removing the best month and the best completed 12-hour bucket.

## Recommended Shadow candidate

### `V96_CORE_VOLUME55_TURNOVER10_SHADOW_V1`

Freeze only these two changes relative to the current V96 Core:

- component volume floor: `0.70 -> 0.55`
- portfolio rebalance threshold: `20% -> 10%`

Keep unchanged:

- completed 12-hour decision chronology;
- Weight Band tolerance `5%`;
- forced refresh `12` completed 12-hour bars;
- Bear confirmation `4` completed 12-hour bars;
- Strong Boost gates;
- Whipsaw and drawdown guards;
- total Gross cap;
- current minimum order adjustment `max(5 USD, 1% equity)`;
- PENGU rules and Gross allocation.

Reason for choosing V55_P100 over the most aggressive historical candidate:

- target/rebalance events still increase by `23.64%`;
- Full Normal improves by `44.1233` percentage points;
- Full Severe improves by `33.3095` percentage points;
- maximum drawdown improves by `2.7023` percentage points;
- reused 2026H1 Severe changes from `-5.3217%` to `+1.9025%`;
- it uses the less aggressive threshold inside the passing cluster.

## Rejected approaches

- Lowering the minimum order threshold below `max(5 USD, 1% equity)` did not produce a robust improvement.
- Faster Weight Band alone increased orders but generally damaged Severe performance.
- Core vote-threshold relaxation produced unstable Severe / reused-2026 behavior.
- PENGU volume floor `0.80 -> 0.60` increased trades and aggregate return, but the gain was concentrated in 2026 and worsened 2025.
- Additional low-volume PENGU Short confirmations did not produce a robust multi-year frequency improvement.

## Evidence classification

This is a historical passing cluster, not independent Holdout evidence. The thresholds were selected after inspecting known history, including reused 2026H1.

The candidate must therefore remain Shadow-only under a new strategy ID and frozen fingerprint. A fresh Forward clock is required before any Production review.

Suggested minimum Forward review gates:

- at least `60` calendar days;
- at least `20` candidate target/rebalance events;
- exact current-V96 counterfactual comparison on every completed 12-hour decision;
- observed fees, Funding, Spread, Slippage and actual exchange order filters;
- positive incremental Normal and Severe contribution;
- no material worsening of account drawdown or daily-loss trips;
- no threshold changes after the Forward clock starts.
