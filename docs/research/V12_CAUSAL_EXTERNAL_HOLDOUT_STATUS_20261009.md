# V12 Causal External Holdout Status — 2026-10-09

## Status

**BLOCKED / DEVELOPMENT V6 FAILED EXTERNAL CAUSAL VALIDATION**

Research only. No LIVE or Production changes.

## Why this validation was required

The development replay restored V12 from the 55-trade high-confidence Core to more than 1,000 trades:

- V6 RCAP1.35 @ 10bps: 1,006 V12 trades, PF 2.8302
- @ 20bps: 1,008 trades, PF 2.4627
- @ 30bps: 1,002 trades, PF 2.1300

Those results were strong but were obtained on the studied 2025-08-10 to 2026-08-10 development period.

Before any Production handoff, the full route architecture was rebuilt as a causal router and tested on separately fetched post-period Aster H1 data.

## Causal-router parity gate

Stage2 and Stage3 development route membership was regenerated from the stored rule conditions rather than candidate IDs.

Development-period exact route parity:

- Stage2: **404 / 404**
- Stage3: **344 / 344**

Therefore the saved candidate IDs were a materialization of causal rules on the development data, not the only mechanism by which routes could be identified.

## External data gate

Separate Aster H1 refetch:

- external entry start: 2026-08-11 00:00 UTC
- conservative entry end: 2026-10-04 22:00 UTC
- market data end: 2026-10-08 00:00 UTC
- development/holdout overlap parity previously verified:
  - 14 / 14 symbols
  - 1,704 overlapping H1 bars per symbol
  - zero OHLCV mismatches

Exact current buildV12Signals() generated **299** baseline candidates in the common external window.

Frozen route rules assigned 267 baseline candidates. Seven failed-break Core candidates were added, producing **274 causal V12 route trades** before portfolio ownership competition.

No development candidate identity was used for external routing.

## Full frozen multi-logic external result

### 10bps
- trades: **274**
- WR: **40.88%**
- PF: **0.5883**
- mean/trade: **-1.157%**
- summed unit net return: **-3.1703**

### 20bps
- PF: **0.5620**
- mean/trade: **-1.257%**

### 30bps
- PF: **0.5369**
- mean/trade: **-1.357%**

The frozen 1,000-trade development architecture therefore **fails external validation** and must not be promoted.

## Family-level external result

### FAILED_BREAK Core
7 trades:
- 10bps: WR 71.43%, PF **1.9381**
- 20bps: PF **1.4646**
- 30bps: PF **1.0825**

Small sample, but still positive through 30bps.

### Robust complement
2 trades:
- 10bps PF 0.4919
- too small and negative to validate.

### Stage1 G family
11 trades:
- 10bps PF 1.0033
- 20bps PF 0.5734
- 30bps PF 0.3479

Not robust.

### Stage2 X family
91 trades:
- 10bps: WR 51.65%, PF **2.6925**, mean +1.980%
- 20bps: PF **2.5418**
- 30bps: PF **2.4010**
- result excluding the single best trade remains strongly positive.

Stage2 is the only broad recovery family that survives external validation.

Notable diagnostics:
- X09 TIME48: 32 trades, 10bps PF 3.0915
- X10 TIME48: 14 trades, PF 1.8011
- X14 TIME48: 29 trades, PF 3.6631

These are diagnostic observations only. The external holdout has now been inspected and cannot be used as a pristine tuning set for a new claimed-OOS architecture.

### Stage3 Y reversal family
163 trades:
- 10bps: WR 34.36%, PF **0.2440**, mean -3.057%
- 20bps: PF **0.2318**
- 30bps: PF **0.2201**

This is the principal failure.

In particular:
- Y06 REV_D0_T72: 102 trades, 10bps PF **0.2995**, summed unit return -3.069
- Y01: PF 0.0352
- Y03: PF 0.3010
- Y07: PF 0.2497
- Y09: PF 0.0364

The development-period Stage3 reversal edge was regime-dependent / overfit.

## Monthly external behavior

10bps:
- 2026-08: 101 trades, PF 0.624
- 2026-09: 158 trades, PF 0.543
- 2026-10 partial: 15 trades, PF 3.173

The problem is not one isolated loss. August and September are broadly negative.

## Additional robustness research

A pre-existing causal walk-forward KNN router was also reviewed:

- 1,028 trades
- 10bps PF 0.948
- 20bps PF 0.880
- 30bps PF 0.818

The REVERSE action was the main drag.

A FOLLOW-only adaptive multi-exit scan using only prior data and exits {2h, 6h, 12h, 24h, Legacy} could also retain >1,000 trades, but all >1,000 configurations were negative at 20bps (best roughly PF 0.73) and showed severe quarter instability.

Therefore merely choosing exits adaptively does not solve the regime problem.

## Four-fold fixed-rule robustness gate

Using only the development period, requiring each route to be profitable in all four chronological quarters at 20bps produced 29 candidate rules, all on the SHORT side.

Requiring each newly added uncovered subset to remain positive reduced the robust union to four routes / 161 unique trades:

1. SHORT, age 0–24h, 6h return < 0; TIME6
2. SHORT, REL12 positive, REL24 positive, 24h breakout; TIME24
3. SHORT, age 0–24h, pullback >1.5 ATR, opposing body; TIME6
4. SHORT, age 24–48h, REL12 negative, range not top25%; TIME12

Union:
- 10bps: 161 trades, PF 1.760
- 20bps: PF 1.622
- 30bps: PF 1.496

This is much smaller than 1,000 but substantially more temporally robust.

## Research decision

1. **Demote V6 RCAP1.35 from Production candidate to development-only artifact.**
2. Preserve FAILED_BREAK Core.
3. Preserve Stage2 family as a promising externally surviving research family, but do not retune it on this now-inspected holdout.
4. Reject the current Stage3 reversal architecture.
5. Do not solve the 1,000-trade target by relaxing gates or forcing reversal trades.
6. Next research must create additional logic families specifically for the regimes where the V12 candidate stream has negative expectation, validated through chronological cross-validation before any external retest.

## Next direction

The target remains roughly 1,000 profitable annual V12-family trades, but the count must come from **different causal regime-specific strategies**, not from forcing the same V12 candidate stream to trade in every regime.

No LIVE/Production change is authorized or performed by this report.
