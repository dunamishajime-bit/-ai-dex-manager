# Major Core + PENGU Balanced Research — Codex Handoff

## Purpose

This branch builds a balanced portfolio in two separate stages:

1. Create a major-currency core for BTC, ETH, BNB and SOL with explicit anti-overfitting controls.
2. Add the frozen PENGU large-wave sleeves from V57 Long and V67 Short, while ranking the combined portfolio primarily by the result after profitable PENGU large-wave trades are removed.

This is research only. It does not change Production, LIVE, VPS, account settings or order execution.

## Repository state

- Repository: `dunamishajime-bit/-ai-dex-manager`
- Production base at research start: `9ff76be095cffb204c3fb4cb718e21febbdacb5a`
- Research branch: `research/major-core-pengu-balanced-v73`
- PENGU research source branch: `research/pengu-wave-sleeve-v47`
- V67 evidence PR: #46, `DISTRIBUTION_FLOOR_FULL_PASS`, closed and unmerged
- V68–V72 combined-core research source: `research/v35-core-pengu-v67-combined`

Do not merge or promote this branch until the GitHub Actions evidence has completed and Codex has reviewed the generated JSON, methodology and risk specification.

## Research lineage retained for review

The branch history contains the PENGU research progression:

- V47–V49: initial Wave Sleeves; rejected for Holdout or Severe weakness.
- V50: Long/Short separated and one-hour decisions; Long Holdout improved but early capture failed.
- V51–V56: early-wave Scout and Washout studies; several rejected because recent Holdout or Severe failed.
- V57: fixed Washout Long plus independent Short; first Aster Long/Short gate pass.
- V58–V60: Binance official archive extension, large-wave-included/excluded analysis and delayed Exit research.
- V61: unconfirmed Probe removed.
- V62–V64: adaptive sizing and robustness stress.
- V65–V67: conditional Distribution, Flash gate and Distribution floor; V67 passed Archive and Aster robustness.
- V68–V72: same-timeline V35 Core/PENGU combination and Gross-cap sizing studies. These are historical upper-bound studies, not final production sizing evidence.

Important interpretation:

- Capturing PENGU large waves is retained as a required functional capability.
- The main robustness metric is the result after profitable PENGU trades overlapping same-direction 24h >=20% or 72h >=35% waves are set to zero. Losses and costs remain.
- Historical PENGU evidence is not pristine forward evidence.

## V73 major-currency anti-overfit design

File: `scripts/research_lab_major_core_nested_v73.py`

### Universe

- BTCUSDT
- ETHUSDT
- BNBUSDT
- SOLUSDT

The universe is intentionally limited. LINK and AVAX are excluded from this stage to reduce universe-selection and survivorship risk.

### Data and chronology

- Binance official USD-M monthly public archive
- 1h source data, resampled to completed 12h bars
- Test period: 2023-01-01 through 2026-07-01, subject to archive coverage
- Signals use completed 12h bars
- Orders are represented from the next 12h Open
- Severe mode adds one full 12h bar of execution delay
- Funding and transaction costs are included

### Signal search space

The Entry family is intentionally simple and low-dimensional:

- BTC regime SMA: 60 / 90 / 120 days
- Asset SMA: 30 / 45 / 60 days
- Momentum: 20 / 40 / 60 days
- Top K: 1 / 2
- Rebalance: 2 / 4 / 6 days

Bull regime selects the strongest eligible members of BTC/ETH/BNB/SOL. Bear regime uses BTC Short only. Cash is allowed.

### Risk search space

- Bull Gross: 0.80 / 1.00 / 1.20
- BTC Bear Gross: 0.30 / 0.50
- Per-position hard stop: 2.5 / 3.5 ATR, ATR frozen at Entry
- Target annualized volatility: 40% / 55%
- Per-symbol Gross cap: 0.45 / 0.60
- Drawdown brake starts at 12% / 18%
- Major-core Gross cap: 1.55
- Cash reserve: 2%

Drawdown brake:

- At the selected threshold: all Core weights scale to 0.65
- A further 8 percentage-point drawdown: all Core weights scale to 0.40
- After a hard stop: one completed 12h-bar cooldown

Costs:

- Normal: 10 bps per unit of turnover
- Severe: 35 bps per unit of turnover
- Severe adverse movement: additional 5 bps per Gross per 12h bar

### Nested Walk-Forward

Five expanding outer tests:

- 2024 H1
- 2024 H2
- 2025 H1
- 2025 H2
- 2026 H1

For every outer fold:

1. Signal models are selected using only the prior Development and six-month inner Validation period.
2. A five-member neighbor-stable ensemble is built.
3. Risk settings are then selected separately using only Development and inner Validation.
4. The selected ensemble and risk are frozen for the outer test.

The final model is based on configurations repeatedly selected across outer folds, not the single highest full-period result.

### Multiple-testing controls

V73 implements:

- Deflated Sharpe Ratio on monthly outer-OOS returns
- White's Reality Check using monthly block bootstrap
- SPA-style studentized approximation
- 30-day decision-block permutation test
- Parameter-neighborhood stability for both Signal and Risk settings

The forward-freeze manifest is written to:

- `.research-state/major-core-v73-forward-freeze.json`

Retuning is forbidden until both conditions are met:

- At least 30 forward trades
- At least six forward months

## V74 balanced integration

File: `scripts/research_lab_major_pengu_balanced_v74.py`

### PENGU Long

Source: V57 confirmed Long trades only.

- Decision interval: one hour
- Families: Washout reversal and Break continuation
- Unconfirmed Probe-only trades: disabled
- Base maximum Gross: 0.15 before balance scaling
- Extreme confirmed sequence: 0.05 Probe followed by 0.10 Add only after confirmation
- Hard stop: 1.2 ATR
- Partial take-profit: 2.0 ATR
- Trailing distance: 1.8 ATR
- Maximum hold: 24 hours
- Funding unavailable or above Long cap: fail closed

### PENGU Short

Source: V67 Distribution Floor.

- Short has priority if Long and Short conflict
- Distribution floor Gross: 0.10
- Qualifying Distribution or Flash Gross: 0.30
- Flash hard stop: 3.5 ATR
- Flash maximum/delayed-trail horizon: 36 hours
- Distribution hard stop: 2.5 ATR
- Distribution maximum/delayed-trail horizon: 24 hours
- Short remains independent of missing Funding

### Portfolio balance search

Only sleeve scales and portfolio drawdown brakes are searched:

- Long scale: 0 / 0.50 / 1.00 of its base Gross
- Short scale: 0.50 / 0.75 / 1.00 of its V67 Gross
- Portfolio DD brake: none / 15% / 20%

Selection priority:

1. Large-wave-excluded Severe return
2. Large-wave-excluded normal return
3. Full Severe return
4. Full return with drawdown preservation

Required gates:

- Combined full return exceeds Core
- Combined large-wave-excluded return is not below Core
- Full and large-wave-excluded Severe results are positive
- Full DD is no more than two percentage points worse than Core
- 2026 H1 Holdout normal, Severe, excluded and excluded-Severe are non-negative
- Observed concurrent Gross does not exceed 2.0

### Portfolio risk hierarchy

1. Core receives Gross capacity first.
2. PENGU is clipped to maintain total observed Gross <=2.0.
3. At the selected portfolio DD threshold:
   - Core scale 0.85
   - PENGU scale 0.60
4. A further 8 percentage-point DD:
   - Core scale 0.65
   - PENGU scale 0.35
5. PENGU Long and Short never overlap.
6. Short wins conflicts.
7. A production direction reversal must close reduce-only and open the opposite side on the next tick.

## Concentration and stress evidence

V74 reports:

- Normal and Severe full-period results
- PENGU large-wave-included and large-wave-excluded results
- 2026 H1 Holdout for all four variants
- Removal of the best PENGU trade
- Removal of the best PENGU month
- Observed maximum concurrent Gross
- Minimum and average realized PENGU scaling after the total-Gross cap

## Reproduction

GitHub Actions workflow:

- `.github/workflows/major-core-pengu-balanced-v73.yml`

Execution order:

```text
python scripts/research_lab_major_core_nested_v73.py
python scripts/research_lab_pengu_wave_sleeve_v57.py
python scripts/research_lab_pengu_v67_distribution_floor.py
python scripts/research_lab_major_pengu_balanced_v74.py
```

Artifact:

- `major-core-pengu-balanced-v73-v74`

Expected result files:

```text
major-core-nested-v73.json
major-core-nested-v73.md
major-core-v73-forward-freeze.json
pengu-wave-sleeve-v57.json
pengu-wave-sleeve-v57.md
pengu-v67-distribution-floor.json
pengu-v67-distribution-floor.md
major-pengu-balanced-v74.json
major-pengu-balanced-v74.md
```

## Codex review checklist

- Verify all data features are lagged and use completed candles only.
- Verify no outer-test or final Holdout data enters model/risk selection.
- Verify the permutation applies the full 30-day decision bundle rather than single-bar shuffling.
- Verify Deflated Sharpe trial count includes Signal and Risk searches across outer folds.
- Verify large-wave exclusion zeroes only profitable overlapping PENGU trades; losses and costs remain.
- Verify Core priority and PENGU clipping keep total Gross <=2.0.
- Verify all stated stops, cooldowns and Gross limits match JSON outputs.
- Verify no Production, LIVE, VPS or order code changed in this research PR.
- Do not promote if V73 is not `MAJOR_CORE_ROBUST_PASS` or V74 is not `BALANCED_FULL_PASS`.
