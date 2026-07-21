# Dis-Dex V96 Extended Alpha and Crowding-Guard Research

Date: 2026-07-21

## Status

- Scope: BTC, ETH, BNB and SOL Core; PENGU excluded
- Historical window: 2023-01-01 through 2026-06-30 UTC
- Production changed: **NO**
- VPS or LIVE service changed: **NO**
- Orders sent: **NO**
- PR status: research Draft only
- Production promotion: **NOT APPROVED**

## Research discipline

The work used completed candles, next-bar execution, an unchanged total Gross cap and separate Normal and Severe assumptions. Candidate families were declared before their results were read. The 2025 and 2026H1 periods are reused historical evidence and are not pristine Forward evidence.

A candidate was not accepted merely for improving full-period return. It also had to preserve or improve the required time splits, Severe execution, drawdown, event diversity, Leave-one-symbol-out results and top-event-removal results.

## Independent Alpha result

A total of **96 independent Alpha candidates** were screened outside the frozen V95/V96 Core:

| Family | Candidates | Historical passes |
| --- | ---: | ---: |
| Completed-12h Long breakout/retest and rank persistence | 10 | 0 |
| Completed-4h Long breakout/retest, resumption and rank persistence | 10 | 0 |
| Bear breakdown and weakest-alt Short | 10 | 0 |
| Funding level and funding spread | 16 | 0 |
| Funding acceleration and price/funding divergence | 16 | 0 |
| Mark-index premium fade, funding-confirmed fade and premium spread | 18 | 0 |
| BTC-beta-neutral residual mean reversion and residual momentum | 16 | 0 |
| **Total** | **96** | **0** |

### Funding level and spread

The strongest Funding-level candidate was `NEG_FUND_MOM_LONG_L4_T2_H4`:

- Full Normal delta: +3.7533 percentage points
- Full Severe delta: -12.0228 percentage points
- 2025 Normal / Severe delta: +1.0724 / -0.7643 points
- 2026H1 Normal / Severe delta: -2.0068 / -5.7137 points
- events: 86
- Alpha/Core correlation: 0.0118

Funding level, acceleration and cross-symbol Funding-spread candidates all failed the Severe execution test. Funding by itself is not supported as an additional order signal.

### Mark-index premium

Aster Mark Price and Index Price histories covered all 2,554 completed 12-hour Core decisions for ETH, BNB and SOL.

The strongest Normal-return premium candidate was `PREM_FUND_W60_Z2_H4`:

- Full Normal delta: +26.3186 points
- Full Severe delta: -17.3903 points
- 2025 Normal / Severe delta: +4.4538 / -2.3081 points
- 2026H1 Normal / Severe delta: +4.7343 / +0.0601 points
- events: 132
- Alpha/Core correlation: -0.1793

The apparent premium edge did not survive the Severe delay and execution assumptions. Mark-index premium is useful as a crowding feature, but not supported as a standalone order signal from this evidence.

### BTC-beta-neutral residuals

The best full-Severe residual candidate was `RESID_MOM_W60_R4_Z2_H8`:

- Full Normal delta: -0.5881 points
- Full Severe delta: -18.1249 points
- 2025 Normal / Severe delta: -1.2778 / -3.0738 points
- 2026H1 Normal / Severe delta: +0.7013 / -2.5187 points
- events: 127

The residual family had low conceptual beta exposure but did not produce robust after-cost Alpha.

## Crowding-guarded Strong-Boost sizing

Rather than adding a new order signal, the historical near-pass `EXACT_BOOST_PYRAMID2P5_T6` was replayed with Funding and premium crowding guards. Its existing conditions remained unchanged:

- existing active Core exposure;
- Strong Boost active;
- Whipsaw inactive;
- drawdown stage zero;
- cumulative signed symbol move at least +6%;
- latest completed 12-hour signed return positive;
- one 2.5% multiplicative weight add per exposure episode;
- unchanged total Gross cap.

### First historical screen pass

`BOOST2P5_T6_FUND1_L1` added one condition:

- the latest completed 12-hour Funding bucket must be at most **1.0 bps**.

Historical result versus the frozen baseline:

- Full Normal delta: +1.5849 points
- Full Severe delta: +0.4365 points
- maximum-drawdown delta: -0.0785 points
- Normal activation events: 5
- activation years: 2023 and 2024
- activation symbols: BNB, ETH and SOL
- positive-event rate: 80%
- rejected otherwise-eligible activations: 41
- 2025 Normal / Severe delta: 0.0 / 0.0
- 2026H1 Normal / Severe delta: 0.0 / 0.0

This was the first candidate to pass its declared historical screen, but the initial neighboring-threshold check was incomplete.

## Local Funding-cap sensitivity

A local sensitivity test used completed-12h Funding caps of 0.0, 0.5, 0.75, 1.0, 1.25, 1.5 and 2.0 bps. Add size, +6% trigger and all V95 controller conditions remained fixed.

| Funding cap | Pass | Full Normal delta | Full Severe delta | Events | Positive rate |
| ---: | --- | ---: | ---: | ---: | ---: |
| 0.00 bps | No | +0.5048 | +0.2084 | 2 | 100% |
| 0.50 bps | No | +0.5048 | +0.2084 | 2 | 100% |
| 0.75 bps | No | +0.5048 | +0.2084 | 2 | 100% |
| **1.00 bps** | **Yes** | **+1.5849** | **+0.4365** | **5** | **80%** |
| **1.25 bps** | **Yes** | **+1.5849** | **+0.4365** | **5** | **80%** |
| **1.50 bps** | **Yes** | **+1.5849** | **+0.4365** | **5** | **80%** |
| 2.00 bps | No | +0.2832 | +0.5192 | 8 | 50% |

The 1.0–1.5 bps plateau produced exactly the same event set and passed the adjacent-threshold requirement. This reduces the risk that the 1.0 bps result is a single-point threshold accident.

However, the accepted plateau had no activations in 2025 or 2026H1. Zero change in those periods is not evidence that the candidate is robust in those regimes.

## Decision

`EXACT_BOOST_PYRAMID2P5_T6_FUND1_L1` is classified as:

**HISTORICAL_STABLE_LEAD_SHADOW_ONLY_NOT_APPROVED**

It is the first result in this research line to satisfy both a historical screen and local adjacent-threshold stability. It is not approved for Production because:

1. only five historical Normal events were observed;
2. the accepted events occurred only in 2023 and 2024;
3. Severe replay produced only two activation events;
4. no untouched Forward evidence exists;
5. historical Mark/Funding quality does not prove live fill quality.

The conservative 1.0 bps boundary is frozen for a separate Shadow contract. The Shadow contract must always return `orderSubmissionAllowed = false` and must not alter the live V96 target.

## Forward gate

The Funding-guarded candidate may not be reviewed for Production until all of the following are met under its own frozen strategy ID and config fingerprint:

- at least 60 calendar days;
- at least 10 eligible activation events;
- activations from at least two Core symbols;
- at least 95% completed-decision and Funding-data coverage;
- exact reconciliation against the unchanged live V96 target;
- observed Funding plus conservative fee and slippage attribution;
- positive Normal and Severe counterfactual contribution;
- no single positive event above 40% of total positive contribution;
- no material worsening of account drawdown or daily-loss-trip frequency;
- no threshold or rule changes after the Forward clock begins.

Any rule change requires a new strategy ID, a new fingerprint and a new Forward clock.
