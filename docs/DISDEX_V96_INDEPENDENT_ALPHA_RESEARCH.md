# Dis-Dex V96 Independent Alpha Research

Date: 2026-07-21

## Status

- Scope: BTC, ETH, BNB and SOL Core; PENGU excluded
- Frozen Core: V90 Weight Band plus V86 Strong Boost
- Historical window: 2023-01-01 through 2026-06-30 UTC
- Independent Alpha candidates screened: 30
- Historical screen passes: **0**
- Production changed: **NO**
- VPS or LIVE service changed: **NO**
- Orders sent: **NO**
- Promotion status: **NOT APPROVED**

The research used predeclared small candidate families. It did not optimize Production V96 parameters against known losing trades.

## Validation requirements

Every candidate was evaluated against:

- development period 2023–2024;
- reused validation period 2025;
- reused diagnostic period 2026H1;
- Normal and Severe execution assumptions;
- next-completed-bar entry chronology;
- the unchanged total Gross cap, with the frozen Core receiving priority;
- minimum event, year and symbol representation;
- low correlation with the frozen Core;
- Leave-one-symbol-out stability;
- best-event removal;
- maximum-drawdown preservation.

A candidate had to improve the combined portfolio in all required periods under both Normal and Severe assumptions. Zero candidates passed.

## Track 1: completed-12h independent Long Alpha

Ten candidates were tested:

- breakout followed by retest while the frozen Core was effectively flat;
- cross-sectional rank persistence in a symbol not held by the frozen Core;
- 4- and 8-bar holding periods;
- fixed independent Gross of 0.15.

The strongest Normal-return candidate was `RANK_M20_P2_H4_DIV`:

- Full Normal delta: +45.6723 percentage points
- Full Severe delta: -29.9182 percentage points
- 2025 Normal / Severe delta: +4.9434 / -3.2685 points
- 2026H1 Normal / Severe delta: +0.1285 / -1.2601 points
- events: 142
- Alpha/Core correlation: 0.0848

The candidate produced apparent gross historical opportunity but failed badly under delayed and costly execution. This is not promotable edge.

The most Severe-resistant completed-12h candidate was `BRK_RETEST_L40_H8_FLAT`:

- Full Normal delta: +17.9234 points
- Full Severe delta: -1.8701 points
- 2025 Normal / Severe delta: +3.8528 / -0.3662 points
- 2026H1: no activation
- events: 15
- Alpha/Core correlation: 0.0896

It remained negative under the full Severe scenario and had no 2026H1 evidence.

## Track 2: completed-4h independent Long Alpha

Ten candidates were tested:

- 4-hour breakout and retest;
- two-bar pullback followed by trend resumption;
- 4-hour rank persistence;
- 24- and 48-hour holding periods;
- fixed independent Gross of 0.10;
- next-4h entry, with an additional 4-hour delay in Severe.

The strongest candidate was `4H_BRK_RETEST_L60_H6_FLAT`:

- Full Normal delta: +10.3777 points
- Full Severe delta: -1.2481 points
- 2025 Normal / Severe delta: +1.7587 / +1.8476 points
- 2026H1 Normal / Severe delta: -0.7700 / -0.4571 points
- maximum-drawdown delta: +0.7105 points
- events: 43 across BTC-regime opportunities in ETH, BNB and SOL
- Alpha/Core correlation: 0.0483

The lower timeframe improved independence and 2025 Severe behavior, but the edge reversed in 2026H1 and remained negative over the full Severe period.

Longer 4-hour holds and rank-persistence variants generally increased transaction and reversal exposure. None passed.

## Track 3: independent Bear Alpha

Ten Short candidates were tested only when:

- BTC was below its slow average with negative momentum;
- the frozen Core held no active alt Long;
- the frozen Core was flat or BTC-short;
- the independent Short Gross was fixed at 0.10.

The best recent-regime candidate was `BEAR_BREAK_L40_H8`:

- Full Normal delta: -6.4866 points
- Full Severe delta: -2.3732 points
- 2025 Normal / Severe delta: -5.2888 / -4.1036 points
- 2026H1 Normal / Severe delta: +4.0348 / +2.7278 points
- events: 33
- Alpha/Core correlation: 0.1043

This candidate captured the 2026H1 bearish regime but lost during the earlier periods. Promoting it from the reused 2026 sample would be direct regime overfitting.

All relative-weakness Short variants were negative over the full period and failed the Severe screen.

## Interpretation

The tests confirm that substantial market moves remain outside the current Core. They do not confirm that the tested extra logic can capture those moves robustly after realistic execution degradation.

The key result is:

> More rules based on the same price-momentum information increased historical Normal return, but did not create stable independent edge under Severe costs and time separation.

Adding more thresholds, lookbacks or holding periods to these same families would increase search degrees of freedom and overfitting risk.

## Frozen Forward Shadow contract

The existing historical near-pass remains:

`EXACT_BOOST_PYRAMID2P5_T6`

A frozen TypeScript Shadow contract and protocol were added and self-tested. The contract:

- requires Strong Boost active, Whipsaw inactive and drawdown stage zero;
- requires at least +6% cumulative signed move and a positive latest completed 12-hour signed return;
- permits at most one counterfactual add per exposure episode;
- multiplies the existing symbol weight by 1.025;
- applies the unchanged Gross 2.0 proportional cap;
- has deterministic config fingerprinting;
- always returns `orderSubmissionAllowed = false`.

The contract self-test passed in GitHub Actions. It is not connected to an exchange or LIVE order path.

## Decision

Do not change Production V96 from these historical tests.

Do not add:

- generic completed-12h rank persistence;
- generic 12h or 4h breakout/retest;
- generic 4h trend resumption;
- generic weakest-alt Short;
- generic alt breakdown Short.

Keep `EXACT_BOOST_PYRAMID2P5_T6` as Shadow-only and collect pristine Forward evidence under the frozen protocol.

## Next research direction

Further research should add genuinely new information rather than more transformations of the same OHLCV momentum:

1. execution-aware signals using observed spread, fill quality and slippage;
2. funding and basis dislocation with separate attribution;
3. open-interest or liquidation-state confirmation where trustworthy data coverage exists;
4. regime-specific models selected by rules frozen before the Forward period;
5. rolling walk-forward evaluation rather than another optimization over the 2023–2026 window.

Any new family must receive a new strategy ID and a new untouched Forward clock. Historical results from this PR must not be reused as pristine Forward evidence.
