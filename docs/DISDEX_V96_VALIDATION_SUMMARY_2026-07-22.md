# Dis-Dex V96 Validation Summary — 2026-07-22

## 1. Status

- Scope: V96 non-PENGU Core for BTC, ETH, BNB and SOL
- Frozen historical window: 2023-01-01 through 2026-06-30 UTC
- Completed 12-hour decisions: 2,554
- Baseline: V90 Weight Band plus V86 Strong Boost used by V95/V96
- Production V96 changed: **NO**
- VPS or LIVE service changed by this research: **NO**
- Orders sent by research code: **NO**
- PR status: **Draft research only**
- Production promotion: **NOT APPROVED**

The research separates historical discovery from Production promotion. The 2025 and 2026H1 periods have already been inspected and therefore are reused historical evidence, not untouched Forward evidence.

## 2. Baseline performance

| Scenario | Compounded return | Maximum drawdown | Profit factor |
| --- | ---: | ---: | ---: |
| Normal | +343.7621% | -30.7176% | 1.2722 |
| Severe | +41.0068% | -46.2852% | 1.0913 |

Severe assumptions use 50 bps turnover cost, a one-bar execution delay and 3 bps adverse execution. Severe annual performance was negative in 2024, 2025 and 2026H1. The gap between Normal and Severe is a major execution-fragility warning.

## 3. Symbol attribution and loss structure

| Symbol | Total contribution | Episodes | Winning episodes | Worst episode |
| --- | ---: | ---: | ---: | ---: |
| BTC | +8.6093% | 28 | 46.4286% | -3.8732% |
| ETH | +29.6782% | 38 | 44.7368% | -3.9695% |
| BNB | +26.2872% | 34 | 50.0000% | -4.0919% |
| SOL | +113.7225% | 39 | 35.8974% | -18.4955% |

All four symbols contributed positively over the full period. SOL has the lowest win rate and largest single loss, but it is also the largest return source.

Repeated losses were concentrated in short and medium-duration episodes:

- SOL 1–2 bars: -10.9225%
- SOL 7–14 bars: -11.9973%
- BNB 3–6 bars: -6.1998%
- BTC 3–6 bars: -5.4120%
- BTC 7–14 bars: -5.4936%
- ETH 3–6 bars: -4.1013%
- ETH 7–14 bars: -3.7300%

By contrast, episodes lasting at least 15 bars were positive for every symbol:

- SOL: +140.1388%
- ETH: +39.8092%
- BNB: +25.8672%
- BTC: +22.1626%

### Strong Boost finding

Strong Boost was active in only 56 of 2,554 Normal buckets, approximately 2.19%.

- SOL episodes experiencing Boost: 77.78% win rate, +156.7958%
- SOL episodes without Boost: 23.33% win rate, -41.9745%
- ETH episodes experiencing Boost: 88.89% win rate, +43.7944%
- ETH episodes without Boost: 31.03% win rate, -13.1613%

The evidence does **not** support removing or weakening Strong Boost. The repeated losses are mainly non-Boost short and medium-duration rotations.

## 4. Profit capture audit

Across 139 completed symbol exposure episodes:

- average maximum favorable excursion: 8.0578%
- average return at exit: 2.6775%
- average profit giveback: 5.3803%
- episodes giving back at least 4%: 50.3597%
- average post-exit return after 1 / 3 / 6 bars: -0.0928% / -0.2480% / -0.0003%

A large amount of unrealized profit is returned, but the post-exit result shows that simply delaying every exit is not supported.

### Rejected generic modules

The following isolated modules failed the predeclared multi-period and Severe-cost screens:

- 50% entry probes
- first-bar confirmation entries
- fixed partial profit taking
- generic trailing reductions
- one- and two-bar exit runners
- unconditional winner additions
- weak-entry-only probes
- conditional profit locks after consecutive negative bars
- 5% and 10% pyramiding

Generic profit taking and trailing damaged the rare long trends. Delayed entries missed trend beginnings. Exit runners had no aggregate post-exit continuation edge. Larger additions improved Normal return but reduced Severe robustness.

## 5. Independent Alpha research

A total of **96 independent Alpha candidates** were screened outside the frozen Core.

| Family | Candidates | Historical passes |
| --- | ---: | ---: |
| Completed-12h Long breakout/retest and rank persistence | 10 | 0 |
| Completed-4h Long breakout/retest, resumption and rank persistence | 10 | 0 |
| Bear breakdown and weakest-alt Short | 10 | 0 |
| Funding level and Funding spread | 16 | 0 |
| Funding acceleration and price/Funding divergence | 16 | 0 |
| Mark-index premium fade and premium spread | 18 | 0 |
| BTC-beta-neutral residual mean reversion and momentum | 16 | 0 |
| **Total** | **96** | **0** |

Several candidates increased Normal historical return, but none survived Severe execution, time separation and robustness controls. Funding and Mark-index premium may be useful as crowding filters, but this evidence does not support using them as standalone order signals.

## 6. Best historical lead

### Strategy

`EXACT_BOOST_PYRAMID2P5_T6_FUND1_L1`

The candidate preserves the existing V96 Core and adds one small counterfactual sizing action only when all conditions are satisfied:

- the Core position is already active;
- Strong Boost is active;
- Whipsaw is inactive;
- drawdown stage is zero;
- cumulative signed symbol move is at least +6%;
- the latest completed 12-hour signed return is positive;
- the latest completed 12-hour Funding bucket is at most 1.0 bps;
- multiply the existing symbol weight by 1.025 once per exposure episode;
- preserve the existing Gross 2.0 cap.

### Historical delta versus frozen V96 Core

| Metric | Delta |
| --- | ---: |
| Full Normal return | +1.5849 percentage points |
| Full Severe return | +0.4365 percentage points |
| Maximum drawdown | 0.0785 percentage points worse |

Other evidence:

- Normal activation events: 5
- activation years: 2023 and 2024
- activation symbols: BNB, ETH and SOL
- positive-event rate: 80%
- Severe activation events: 2
- 2025 delta: 0.0 / 0.0 Normal / Severe
- 2026H1 delta: 0.0 / 0.0 Normal / Severe

### Neighboring-threshold stability

Funding caps of 1.0, 1.25 and 1.5 bps produced exactly the same five-event set and the same result. A 2.0 bps cap failed because an added 2025 event reduced Normal return.

This is the first result to pass both its declared historical screen and a local adjacent-threshold check. It remains weak evidence because it contains only five Normal events, two Severe events and no activations in 2025 or 2026H1.

### Classification

**HISTORICAL_STABLE_LEAD_SHADOW_ONLY_NOT_APPROVED**

The TypeScript Shadow contract:

- uses a separate strategy ID and deterministic config fingerprint;
- fails closed on missing or invalid Funding data;
- rejects Funding above 1.0 bps;
- rejects duplicate episode additions;
- preserves the Gross 2.0 proportional cap;
- always returns `orderSubmissionAllowed = false`.

## 7. Concentration and overfitting warning

| Test | Compounded return | Maximum drawdown |
| --- | ---: | ---: |
| Remove best 1 episode | +148.3152% | -30.7176% |
| Remove best 3 episodes | +35.4195% | -30.7176% |
| Remove best 5 episodes | +0.5240% | -38.2767% |

The Core result is materially dependent on a small number of large trend episodes, mainly SOL. This is the strongest robustness warning found in the audit. Symbol-specific rules must not be selected simply because they improve known historical losses.

## 8. Currency-specific interpretation

The following section distinguishes validated findings from proposed next experiments.

### BTC — validated interpretation

- Positive full-period contribution, but repeated losses occur in 3–14 bar episodes.
- BTC is also a market-regime and hedge component, so it should not be optimized only as a standalone profit asset.

### ETH — validated interpretation

- Strong-Boost episodes were highly successful.
- Non-Boost ETH episodes were negative in aggregate.
- ETH participated in the Funding-guarded historical lead.

### BNB — validated interpretation

- Highest episode win rate among the four symbols at 50%.
- Positive contribution with smaller dependence on Strong Boost than ETH or SOL.
- BNB participated in the Funding-guarded historical lead.

### SOL — validated interpretation

- Lowest episode win rate and largest single loss.
- Largest total contribution and dominant 15+ bar trend contribution.
- Removing SOL or applying generic early profit taking is not supported.

### Proposed next experiment — not yet validated

Use a shared market regime, risk controller, Gross cap and execution layer, while testing a small role-based symbol split:

1. **BTC:** one extra completed-bar confirmation for direction reversals.
2. **ETH:** Funding-guarded Strong-Boost add under the frozen 1.0 bps Shadow rule.
3. **BNB:** unchanged baseline as the control symbol.
4. **SOL:** reduced initial entry size with restoration only after continuation confirmation, while preserving the existing long-trend exit behavior.

This must be tested as a predeclared four-arm experiment. It must not introduce separately optimized momentum lookbacks or thresholds for each symbol.

## 9. Promotion gates

The Funding-guarded candidate cannot be reviewed for Production until all gates are satisfied under its frozen strategy ID:

- at least 60 calendar days of Forward Shadow evidence;
- at least 10 eligible activation events;
- activations from at least two Core symbols;
- at least 95% completed-decision and Funding-data coverage;
- exact reconciliation against the unchanged live V96 target;
- observed Funding plus conservative fee and slippage attribution;
- positive Normal and Severe counterfactual contribution;
- no single positive event above 40% of total positive contribution;
- no material worsening of account drawdown or daily-loss-trip frequency;
- no threshold or rule changes after the Forward clock begins.

Any rule change requires a new strategy ID, fingerprint and Forward clock.

## 10. Current decision

1. Keep Production V96 unchanged.
2. Do not add generic take-profit, trailing, delayed-entry, runner, standalone Funding, premium, residual or Bear Alpha modules.
3. Keep `EXACT_BOOST_PYRAMID2P5_T6_FUND1_L1` Shadow-only with order submission disabled.
4. Treat the currency-specific split as the next predeclared historical experiment, not as an approved Production design.
5. Keep PR #60 in Draft state and do not connect the research modules to the LIVE allocator.

## 11. Evidence index

- `docs/research/V96_CORE_LOSS_AUDIT_2026-07-21.md`
- `docs/DISDEX_V96_CORE_PROFIT_CAPTURE_RESEARCH.md`
- `docs/DISDEX_V96_INDEPENDENT_ALPHA_RESEARCH.md`
- `docs/DISDEX_V96_EXTENDED_ALPHA_RESEARCH.md`
- `docs/DISDEX_V96_FORWARD_SHADOW_PROTOCOL.md`
- `scripts/disdex-v96-funding-guarded-boost-shadow-contract.ts`
