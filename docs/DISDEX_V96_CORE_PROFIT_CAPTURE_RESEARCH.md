# Dis-Dex V96 Core Profit-Capture Research

Date: 2026-07-21

## Status

- Scope: BTC, ETH, BNB and SOL Core only; PENGU excluded
- Historical window: 2023-01-01 through 2026-06-30 UTC
- Baseline: frozen V90 Weight Band plus V86 Strong Boost used by V95/V96
- Production code changed: **NO**
- VPS or LIVE service changed: **NO**
- Orders sent: **NO**
- Promotion status: **NOT APPROVED**

The purpose of this research was to measure missed profit and test entry, exit, profit-lock, runner and pyramiding modules without tuning the existing Production V96 parameters to known losing trades.

## Baseline and opportunity size

The frozen Core baseline produced:

- Normal compounded return: +343.7621%
- Normal maximum drawdown: -30.7176%
- Severe compounded return: +41.0068%
- Severe maximum drawdown: -46.2852%

Across 139 completed symbol exposure episodes:

- first 12-hour bar positive: 53.2374%
- average maximum favorable excursion: 8.0578%
- average return at baseline exit: 2.6775%
- average profit giveback: 5.3803%
- episodes giving back at least 4%: 50.3597%
- average post-exit return after 1 / 3 / 6 bars: -0.0928% / -0.2480% / -0.0003%

There is substantial profit giveback, but the near-zero-to-negative average post-exit return shows that simply holding every position longer is not a valid solution.

## Round 1: generic isolated modules

The following modules were screened individually:

- one-bar 50% entry probe
- first-bar-confirmation entry probe
- 25% hard profit taking at 8% and 12%
- 25% trailing reductions at 8%, 12% and 16%
- 25% one- and two-bar exit runners
- unconditional 10% and 20% winner additions

No module passed the predeclared multi-period and Severe-cost screen.

Key findings:

- generic entry probes improved some recent losses but removed too much early exposure from the rare large trends;
- hard profit taking and trailing reductions reduced long-trend capture;
- exit runners did not work because post-exit continuation was not positive in aggregate;
- unconditional winner additions increased Normal return but reduced Severe robustness.

## Round 2: conditional isolated modules

The second screen tested:

- probes only for weak entries;
- partial profit locks only after 8%, 12% or 16% profit and two consecutive negative bars;
- 5% and 10% pyramiding only after 4%, 6% or 8% cumulative profit.

No module passed the complete screen.

Profit locks improved 2025 and Severe results but still cut too much historical long-trend return. Pyramiding increased Normal return, but the 5% and 10% additions were not consistently robust under Severe costs or across the reused 2025/2026 periods.

## Round 3: existing-state-conditioned modules

The third screen restricted the new logic to existing V95 states:

- profit lock only after profit plus two negative bars plus deteriorating momentum, breadth, skew, drawdown or Whipsaw state;
- pyramiding only while Strong Boost was active and drawdown and Whipsaw guards were inactive.

Risk-conditioned profit locks still failed because they reduced historical long-trend capture.

Strong-Boost-conditioned pyramiding was the only family to improve both Normal and Severe full-period results in the first-stage replay. The 2.5% addition family was materially more robust than the 5% family, but all candidates slightly reduced 2025 Normal return.

## Exact controller-feedback replay

The Strong-Boost pyramiding family was replayed again with modified returns fed back into the drawdown, Whipsaw and Strong Boost controller state.

Replay validation:

- maximum Baseline Normal bar difference: 0.0
- maximum Baseline Severe bar difference: 0.0

This confirms the exact replay reproduces the frozen historical controller before the candidate overlay is applied.

### Best historical research lead

`EXACT_BOOST_PYRAMID2P5_T6`

Rule:

- position is already active;
- V95 Strong Boost is active;
- Whipsaw is inactive;
- drawdown stage is zero;
- cumulative symbol move is at least +6%;
- latest completed 12-hour signed return is positive;
- add 2.5% to the existing symbol weight, subject to the existing total Gross cap.

Historical delta versus the frozen baseline:

- Full Normal: +2.0132 percentage points
- Full Severe: +0.6014 percentage points
- 2025 Normal: -0.2482 percentage points
- 2025 Severe: 0.0 percentage points
- 2026H1 Normal / Severe: 0.0 / 0.0 percentage points
- maximum drawdown: 0.1293 percentage points worse
- activation events: 16
- activation years: 2023, 2024 and 2025
- activation symbols: BNB, ETH and SOL
- largest positive event share: 28.29%

The result is distributed across multiple years, symbols and events rather than one exceptional trade. However, it failed the frozen screen because it did not improve 2025 Normal performance and slightly worsened maximum drawdown.

Status: **HISTORICAL_NEAR_PASS_SHADOW_ONLY_NOT_APPROVED**

### Rejected larger addition

The 5% Strong-Boost additions increased Full Normal return by approximately 11–12 percentage points, but reduced Full Severe return by 0.2967 percentage points and reduced 2025 Normal return by 0.4973 percentage points. This sizing is too aggressive for advancement.

## Decision

Do not add a hard take-profit, generic trailing stop, generic delayed entry, generic exit runner or unconditional pyramiding module to Production V96.

Do not promote the 2.5% Strong-Boost pyramiding candidate from reused historical evidence. It is the only candidate suitable for a future Shadow track, not for live sizing.

The current evidence supports two separate next tracks:

1. **Forward Shadow track**
   - emit the `EXACT_BOOST_PYRAMID2P5_T6` counterfactual target without sending orders;
   - record activation, counterfactual quantity, realized path, funding, fees and contribution;
   - require at least 30 calendar days, at least 10 activation events and representation from at least two Core symbols before review;
   - compare with the unchanged live V96 target at every completed 12-hour decision.

2. **Independent alpha track**
   - research a separate, low-correlation entry family rather than adding more exit knobs to the same rotation signal;
   - keep a separate Gross budget and separate attribution;
   - use a predeclared small family such as multi-timeframe breakout/retest or cross-sectional rank persistence;
   - require development/validation separation, Leave-one-symbol-out stability, Severe costs, top-event removal and forward Shadow evidence.

The current V96 Core should remain unchanged while these tracks are evaluated.

## Overfitting controls

Any future candidate must satisfy all of the following before Production review:

- frozen rule and thresholds before inspecting Forward outcomes;
- exact stateful replay and TypeScript parity;
- neighboring-threshold stability;
- Normal and Severe cost assumptions;
- development, validation and untouched Forward separation;
- Leave-one-symbol-out stability;
- best 1, 3 and 5 event removal;
- no material degradation of 15+ bar trend capture;
- explicit attribution showing that gains are not concentrated in one symbol or event;
- Shadow-only operation before any live allocation.
