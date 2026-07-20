# BTC / ETH Major Core Stability Protocol

Generated: 2026-07-20

## Priority

While the frozen PENGU V67 future sample accumulates, research priority moves to stable Core growth from major assets.

Priority order:

1. BTC
2. ETH
3. BNB
4. SOL

PENGU research remains a separate wave sleeve and must not drive Core parameter selection.

## Baseline

- Preserve the current V35 Core as the benchmark.
- Do not optimize against V71 combined CAGR.
- Do not change Production, LIVE, VPS, or order routing during research.
- Total portfolio Gross cap remains 2.0 in all combined simulations.

## Primary objective

Rank candidates by robustness, not maximum return:

1. Positive outer-fold Severe return;
2. positive worst-year return or smallest worst-year loss;
3. improved return / drawdown ratio;
4. positive result after best trade and best month removal;
5. stable monthly profit factor;
6. only then total compounded return.

## Research structure

### Asset separation

- BTC and ETH are researched independently first.
- Long and defensive/flat logic are evaluated separately.
- Cross-asset allocation is evaluated only after each asset passes independently.
- BNB and SOL remain unchanged until BTC/ETH results are frozen.

### Nested walk-forward

Use outer chronological folds that are never used by candidate selection.

Within each outer train period:

- Inner Train selects candidate families.
- Inner Validation selects one candidate without seeing the outer fold.
- Outer Test is evaluated once.
- Candidate parameters are reset and reselected independently for the next outer fold.

Report the stitched outer-test equity curve.

### Candidate families

Keep the search space intentionally small and economically distinct:

- existing V35 trend continuation;
- trend pullback after volatility contraction;
- breakout with BTC/ETH relative-strength confirmation;
- defensive exit / exposure reduction;
- no-trade cash state.

Do not create hundreds of near-identical thresholds.

## Required costs and stress

Report both normal and Severe assumptions.

Required destructive tests:

- fees/slippage at 2x, 3x, and 5x;
- one-bar entry delay;
- one-bar exit delay;
- best trade removed;
- best month removed;
- top three trades removed;
- monthly block bootstrap;
- multiple-testing correction across every attempted candidate;
- parameter-neighborhood stability;
- BTC-only, ETH-only, and combined results.

## Acceptance gates

An asset sleeve may be promoted to the combined Core research candidate only when:

- stitched Nested OOS return > 0;
- stitched Nested OOS Severe return > 0;
- at least three positive outer-test folds;
- PF >= 1.20;
- Max DD no worse than the V35 baseline by more than 3 percentage points;
- best-trade-removed Severe return > 0;
- best-month-removed Severe return > 0;
- 3x cost return > 0;
- no single year supplies more than 60% of total positive profit;
- neighboring parameter sets show the same direction of improvement.

## Promotion order

1. Establish BTC-only robust improvement.
2. Establish ETH-only robust improvement.
3. Combine BTC and ETH under Gross 2.0.
4. Compare against unchanged V35 Core on the same timeline.
5. Add frozen PENGU Track A only after Core results are finalized.
6. Treat V71 sizing as shadow research, not the benchmark objective.

## Reporting

Every result must include:

- all-period and stitched OOS return;
- annual and monthly returns;
- PF, Max DD, average and maximum Gross;
- normal and Severe assumptions;
- asset contribution;
- exposure time;
- concentration by trade, month, and year;
- trial count and corrected significance;
- exact code SHA and data cutoff.

## Safety

Research-only protocol. No Production, LIVE, VPS, or order changes.
