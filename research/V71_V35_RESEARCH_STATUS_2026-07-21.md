# V71 Drawdown Reduction and V35 Growth Research Status

Date: 2026-07-21 JST

## Scope and safety

Repository: `dunamishajime-bit/-ai-dex-manager`

Active research branch: `research/v71-dd-v35-growth-v82`

Draft PR: #55, `Research V82: reduce V71 drawdown without sacrificing PENGU edge`

This work is research only.

- Production changed: NO
- LIVE changed: NO
- VPS changed: NO
- `.env`, API keys, account settings and leverage changed: NO
- Orders sent: NO
- Required operating stance remains `mode=PAPER` and `liveTradingEnabled=false`
- PENGU Long and Short never overlap
- Short has priority when signals conflict
- A production reversal must close reduce-only first and open the opposite direction on the next tick
- PENGU Long fails closed when Funding is unavailable

## User-approved research interpretation

PENGU is retained because detecting and capturing large Long and Short waves is an important functional requirement. Historical tuning around known waves is acceptable for that specific capability.

The primary robustness metric is different:

1. Profitable PENGU trades overlapping same-direction 24h >=20% or 72h >=35% waves are set to zero.
2. Losses and execution costs remain.
3. The large-wave-excluded normal and Severe results determine whether the ordinary PENGU trades add real value.

While frozen forward evidence is collected, the main growth priority is the BTC/ETH/BNB/SOL Core.

## V71 baseline retained for refinement

V71 uses the fixed V35 Core plus the fixed V67 PENGU Short trade sequence with target PENGU Gross 1.15 and a total observed Gross cap of 2.0.

Historical V71 result:

| Metric | Result |
|---|---:|
| Full compounded return | +1,147.69% |
| CAGR | +105.83% |
| Normal MaxDD | -31.77% |
| Severe return | +152.84% |
| Severe MaxDD | -50.24% |
| Large-wave-excluded return | +521.11% |
| Large-wave-excluded Severe | +25.96% |
| Remove-best-trade Severe | +17.99% |
| Remove-best-month Severe | +6.50% |
| Observed maximum concurrent Gross | 2.0 |
| Minimum clip ratio | 51.39% |
| Average clip ratio | 93.27% |

V71 is not rejected for lack of profit. It is treated as a historical upper-bound portfolio because:

- Target Gross 1.15 was chosen after observing the V35/V67 history.
- Severe MaxDD is approximately 50%.
- Several PENGU buckets require clipping to the portfolio Gross cap.
- It is not independent future evidence.

Important diagnosis: V71 normal MaxDD is the same as the V35 Core MaxDD. Therefore simply reducing PENGU would lose return without fixing the main normal-DD source.

## V73-V81 anti-overfitting findings

### V73 — new major-currency Entry search

Rejected.

- Outer OOS: -1.23%
- Outer OOS Severe: -19.69%
- Positive folds: 2/5
- DSR and Reality Check: failed

Conclusion: searching a new Entry family was unstable. New Entry exploration was stopped.

### V75 — V35 Signal fixed, Risk grid only

Rejected.

- Outer OOS: +46.63%
- Outer OOS Severe: -23.39%
- Positive folds: 4/5
- Severe-positive folds: 1/5
- Full: +128.21%
- Full Severe: -6.19%
- DSR probability: 0.83
- Reality Check p: 0.103
- 30-day Block Permutation p: 0.054

Conclusion: normal performance was good, but delayed/high-cost execution was not robust.

### V77 — two completed 12h confirmations and 5% allocation tolerance

Rejected.

- Outer OOS: +16.65%
- Outer OOS Severe: -15.19%
- Positive folds: 2/5
- Severe-positive folds: 2/5
- Full: +60.60%
- Full Severe: +13.01%
- MaxDD: -16.04%

Conclusion: drawdown and full-period Severe improved, but outer-fold consistency remained insufficient.

### V79 — exact V35 `core_series`, Entry/Exit unchanged

Rejected, but statistical evidence improved.

- Outer OOS: +17.39%
- Outer OOS Severe: -9.85%
- Positive folds: 3/5
- Severe-positive folds: 1/5
- Full: +131.19%
- Full Severe: +31.98%
- MaxDD: -20.09%
- Reality Check p: 0.068
- SPA p: 0.023
- 30-day bundle Permutation p: 0.098
- DSR probability: 0.325

Conclusion: the exact Core implementation matters. Reimplemented V35 variants must not replace the validated `core_series` semantics.

### V80 — exact V35 with two confirmations and 5% tolerance

Rejected.

- Outer OOS: +21.22%
- Outer OOS Severe: -11.83%
- Positive folds: 2/5
- Severe-positive folds: 2/5
- Full: +86.03%
- Full Severe: +29.64%
- MaxDD: -15.35%
- Reality Check p: 0.055
- SPA p: 0.022
- Permutation p: 0.026
- DSR probability: 0.457

Conclusion: random-chance evidence improved, but performance was not consistent across market eras.

### V81 — three confirmations and 10% tolerance

Code and dedicated workflow were pushed. At the point this status file was written, V81 had been launched but had not yet produced an accepted result. No claim of improvement is made without its Artifact.

## V82 design: reduce V71 DD while retaining return

V82 does not change:

- V67 trade timestamps
- V67 Long/Short decision logic
- V71 target PENGU Gross 1.15
- Total portfolio Gross cap 2.0
- Large-wave exclusion definition

V82 tests only portfolio drawdown controls that use information known before the current completed 12h bucket.

The design scales the Core first because V71 normal DD matches the Core DD. PENGU is preserved more strongly to retain large-wave capture and the large-wave-excluded ordinary-trade contribution.

Candidate structure:

- Stage-1 DD trigger: 8% / 10% / 12% / 14%
- Stage-2 additional DD: 6% / 8% / 10%
- Core stage-1 scale: 70% / 80% / 90%
- Core stage-2 scale: 35% / 50% / 65%
- PENGU stage-1 scale: 90% / 100%
- PENGU stage-2 scale: 70% / 85% / 100%
- Recovery hysteresis: 2% / 4%

Selection priority:

1. Large-wave-excluded Severe return
2. Large-wave-excluded normal return
3. Normal DD improvement
4. Full return retention

Minimum acceptance gates:

- Observed maximum Gross <=2.0
- Normal DD improves by at least 4 percentage points from V71
- Normal return retains at least 75% of V71
- Large-wave-excluded return retains at least 80% of V71
- Severe DD improves by at least 3 percentage points
- Large-wave-excluded Severe remains positive
- Overlap normal/Severe and excluded normal/Severe remain positive
- Remove-best-trade and remove-best-month Severe remain positive

The result also decomposes each baseline drawdown episode into Core and PENGU return contributions.

## V82 first-run failure and correction

Initial V82 GitHub Actions run:

- Run ID: `29757493924`
- Result: failed before candidate evaluation
- This was not a strategy rejection.

Root cause:

```text
V67 MTM path guard failed: max 12h bucket move 53.9571% exceeds 35.0%
```

V71 had already validated a 75% pre-cap MTM audit guard for proportional PENGU scaling through target Gross 1.30. V82 retains target Gross 1.15, but the first run accidentally inherited the older 35% audit guard.

Correction pushed:

- `scripts/research_lab_v71_drawdown_control_v82_fix_runner.py`
- `.github/workflows/v71-drawdown-control-v82b.yml`

The correction changes only the pre-cap MTM audit guard from 35% to the V71 value of 75%.

It does not change:

- PnL
- Gross-cap logic
- DD triggers
- candidate set
- selection order
- acceptance gates

## V35 growth work after V82

After a V82 candidate is fixed, V35 growth research must use that portfolio as the baseline. The objective is not to inflate historical leverage.

Required sequence:

1. Keep the exact V35 `core_series` Entry/Exit semantics.
2. Decompose Core return by BTC hedge, ETH, BNB and SOL, market regime and drawdown episode.
3. Identify stable return sources and unstable high-turnover sources.
4. Test small, predeclared structural changes only:
   - Bull multiplier neighborhood
   - BTC hedge activation and size
   - rotation persistence/tolerance
   - volatility and drawdown scaling
   - cash reserve and total Core Gross cap
5. Use expanding Nested Walk-Forward.
6. Report normal and Severe by outer fold.
7. Apply Deflated Sharpe, White Reality Check/SPA approximation and 30-day decision-block permutation.
8. Combine the frozen V35 improvement with the frozen V82 PENGU sleeve on the same timeline.
9. Require total observed Gross <=2.0 and report large-wave-included and excluded results separately.

No V35 variant is promoted only because its full-period historical return exceeds V35.

## Files added for the current V82 stage

- `scripts/research_lab_v71_drawdown_control_v82.py`
- `scripts/research_lab_v71_drawdown_control_v82_fix_runner.py`
- `.github/workflows/v71-drawdown-control-v82.yml`
- `.github/workflows/v71-drawdown-control-v82b.yml`
- `research/V71_V35_RESEARCH_STATUS_2026-07-21.md`

## Current promotion status

- V71: historical upper-bound candidate, not Production sizing
- V82: research in progress; corrected CI must complete before assessment
- V35 improvement: starts after a V82 candidate is frozen
- PENGU V67: research sleeve only
- Forward operation: PAPER / SHADOW only
- Production promotion: NOT AUTHORIZED
