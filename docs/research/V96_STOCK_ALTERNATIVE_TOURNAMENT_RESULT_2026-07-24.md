# V96 Stock Alternative Tournament Result — 2026-07-24

## Decision

**NO_ROBUST_STOCK_EDGE_FOUND_IN_CURRENT_ASTER_HISTORY**

Do not promote any tested Stock strategy to Production or LIVE.

The research tested 162 predeclared candidates across 54 distinct strategy families after the original intraday theme-flow candidate failed. Positive isolated intervals were not treated as success unless they retained positive Forward-median, Normal and Severe results through chronological selection and the final reused-historical period.

No Production, LIVE, VPS, Crypto V96 allocation or orders were changed.

## Evidence discipline

- Family parameters were selected on Development only.
- Family winners were screened on Validation.
- A single candidate or equal-weight ensemble was selected from Validation only.
- The last chronological period was evaluated after selection.
- The dates had already been inspected by earlier Stock research, so the final period is reused historical evidence rather than an independent Holdout.
- Failed families were not retuned on the final period.
- Gross 2.0 calculations were sensitivity only and could not rescue a negative Gross 1.0 edge.

## Tournament summary

| Stage | Candidates | Families | Result |
| --- | ---: | ---: | --- |
| V2 intraday multi-family | 27 | 9 | No Validation-passing family |
| V3B corrected swing / pair | 27 | 9 | No Validation-passing family |
| V4 Funding carry | 24 | 8 | No Validation-passing family |
| V5 mature-universe single-position | 24 | 8 | One Validation lead; failed final period |
| V6 multi-asset persistent trend | 24 | 8 | Two Validation leads; selected lead failed final period |
| V7 overnight / Europe lead | 24 | 8 | No Validation-passing family |
| V8B expanding walk-forward Ridge | 12 | 4 | No Validation-passing family |
| **Total** | **162** | **54** | **No robust edge** |

The original frozen V1 intraday theme-flow strategy was evaluated separately and also failed: Forward-median -6.7859%, Normal -10.9792%, Severe -25.2343% over 126 trades.

## Important near-misses

### V2 intraday families

The best Validation pocket was `PM_BREAK_0.30`:

- Validation Forward-median: +0.2182%
- Validation Normal: -0.0697%
- Validation Severe: -1.1431%

It failed because costs removed the small directional edge.

### V3B corrected swing families

The corrected eligibility window began only after at least eight symbols had 61 completed sessions: 2026-04-27 through 2026-07-22, 63 eligible days.

- `DAILY_EXHAUST_1.00`: Validation +25.5378%, Severe +21.9692%, but only four trades.
- `CLOSE_STRENGTH_0.75`: Validation +16.9890%, Severe +14.4734%, but only three trades.
- `DEF_TREND_20`: Development +52.3556%, Severe +45.4077%, but zero Validation trades.

These are sparse observations, not deployable evidence.

### V4 Funding carry

- `NEG_CARRY_0.5`: Development +7.5520%, Severe +4.3717%, but zero Validation trades.
- `DISP_PAIR_2.0`: Development +11.8705%, Severe +6.1425%; Validation -5.2613%, Severe -9.0329%.

Funding was a real PnL component, but the observed opportunities were not persistent across time.

### V5 mature-universe single-position

`BOTTOM_SHORT_0.00` passed Validation but failed the final period.

- Full Forward-median: -13.1182%
- Full Normal: -17.0039%
- Full Severe: -31.1526%
- Final period Forward-median: -0.8599%
- Final period Normal: -1.5378%
- Final period Severe: -4.2071%

### V6 multi-asset persistent trend

`DUAL_BREAKOUT_15` and `LONG_BREAKOUT_15` passed Validation. Validation selected `LONG_BREAKOUT_15`, which failed the final period.

- Full Forward-median: -12.3233%
- Full Normal: -13.3712%
- Full Severe: -17.1987%
- Final period Forward-median: -8.3156%
- Final period Normal: -8.5350%
- Final period Severe: -9.3547%

### V7 overnight / Europe lead

- `OVERNIGHT_CONT_DAY_0.75`: Validation +5.8581%, Normal +3.3549%, Severe -5.5488%.
- `OVERNIGHT_FADE_DAY_0.75`: Development +22.9327%, Normal +13.6869%; Validation -11.3803%.

The direction of the overnight relation reversed between periods.

### V8B expanding walk-forward Ridge

Each prediction used only samples whose outcome had fully completed by that prediction date. Six unique target/regularization paths produced twelve portfolio candidates.

Best Validation pocket, `RIDGE_ABS_LONG_L0.1`:

- Development Forward-median: -14.7393%
- Development Severe: -52.6737%
- Validation Forward-median: +11.8365%
- Validation Normal: +8.5961%
- Validation Severe: -2.7759%

The linear model did not retain an edge under Severe costs and did not reproduce across Development.

## Why the Crypto V96 result is not reproducible from this Stock dataset

The Crypto V96 result uses a much longer 2023-2026 history, continuous liquid markets and a mature multi-regime architecture. The Stock-perpetual history is staggered and short, with many contracts contributing only a few dozen usable regular sessions. Current-listing survivorship bias is substantial, and Spread, depth and Funding differ sharply by symbol and session.

Absolute return comparisons are therefore not equivalent. Applying Gross 2.0 to a negative Stock edge only increases losses and drawdown; leverage does not create edge.

## Credible next research boundary

Further threshold searching on the same Aster history would create data-mined false positives. The next valid Stock research cycle requires new information rather than more parameter combinations:

1. Acquire survivorship-aware underlying U.S. equity 15-minute history covering at least 2020-2026.
2. Use an authoritative exchange calendar including DST, holidays and shortened sessions.
3. Align underlying equity, Aster mark/index/basis, Funding, Open Interest, Spread and depth by timestamp.
4. Predeclare one new basis/carry or underlying-versus-perpetual family before observing the new period.
5. Reserve a genuinely untouched chronological Holdout and then start a fresh Forward clock.

Until those inputs exist, the correct status is `NO_ROBUST_STOCK_EDGE_FOUND_IN_CURRENT_ASTER_HISTORY`, not continued searching until a positive backtest appears.
