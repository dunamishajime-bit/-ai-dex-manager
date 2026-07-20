# V67 Overfit Audit — Large-wave-excluded focus

Generated: 2026-07-20T22:13:21+09:00

## Scope

- PENGU wave capture is evaluated separately and may intentionally be specialized for rare large moves.
- The primary robustness objective is **large-wave-excluded Severe return**.
- Entry and Exit logic are frozen for this audit.
- Only the recorded Gate candidates are reselected.
- Positive PENGU returns overlapping same-direction major waves are set to zero; losses, funding, and costs remain.
- Source Artifact SHA-256:
  - `pengu-v67-distribution-floor.zip`: `cdfff86cd351dd58403e823a94643a81875509bb5a57ad8c889d47c7e0db96c0`
  - `pengu-v67-distribution-floor.json`: `d8748f0b2ef34fd575edf7ac6270219ef01c0f6b457dcde2c341dcf440de9c2a`

## 1. Nested expanding walk-forward

Five chronological folds were created. For outer folds 2, 3, and 4:

- all earlier folds except the immediately preceding fold were Inner Train;
- the immediately preceding fold was Inner Validation;
- candidate selection used only large-wave-excluded Severe returns before the outer test;
- the outer test fold was untouched during selection.

Results:

- Adaptive OOS: **+19.20%**
- PF: **3.63**
- Max DD: **-2.57%**
- Trades: **24**
- Fixed V67 on exactly the same OOS windows: **+19.20% / PF 3.63 / DD -2.57% / 24 trades**

Outer selections:

- Fold 2: `D_M3_GE_N5_F_VOL_GE_0p9` → test **+4.00%**, 11 trades
- Fold 3: `D_M3_GE_N4_F_VOL_GE_0p9` → test **+14.10%**, 7 trades
- Fold 4: `D_M3_GE_N5_F_VOL_GE_0p9` → test **+0.45%**, 6 trades

Interpretation: the excluded-return edge is not explained solely by choosing one final Gate after seeing the last fold. However, the final fold margin remains small.

## 2. Multiple-testing correction

Using monthly large-wave-excluded Severe returns for 30 stored candidate paths:

- White Reality Check p-value: **0.0025**
- SPA-style studentized maximum p-value: **0.0048**
- Observed maximum monthly t-statistic: **3.681**

Approximate Deflated Sharpe sensitivity for the selected Gate:

- 35 trials: **92.62%** probability
- 1,000 trials: **62.84%**
- 10,000 trials: **39.02%**
- 100,000 trials: **20.91%**

Interpretation: the 35-Gate V67 search survives correction, but the conclusion weakens materially when the full human-guided V46–V71 research history is treated as thousands of effective trials.

## 3. Monthly block sign-permutation

Two-month contiguous blocks were used to preserve part of the monthly dependence structure.

- Observed large-wave-excluded Severe return: **+47.11%**
- One-sided block sign-permutation p-value: **0.00883**
- Two-month block bootstrap return:
  - P05: **+22.22%**
  - Median: **+46.80%**
  - P95: **+76.50%**

Cross-venue Aster check:

- Large-wave-excluded Severe: **+17.74%**
- PF: **2.48**
- Max DD: **-6.19%**
- Trades: **26**

## Limitations

- The Artifact stores 30 candidate trade paths while `gateCount=35`; Reality Check uses the 30 stored paths.
- The complete number of human-guided trials across V46–V71 cannot be reconstructed from this Artifact. The multiple-testing result is therefore a lower-bound correction.
- The SPA-style result is a studentized maximum block bootstrap, not a complete Hansen SPA implementation.
- The monthly test is a two-month block sign-permutation. It is not a full price-series permutation that reassigns signals to alternative future paths.
- Aster overlaps much of the Binance period and is not a fully independent future sample.

## Current judgment

- Large-wave capture: retain as a dedicated PENGU purpose.
- Large-wave-excluded alpha: **provisionally supported**, but not yet pristine forward evidence.
- V71 Gross 1.15: sizing research only; do not treat as validated signal evidence.
- Production, LIVE, VPS, and orders: unchanged.
