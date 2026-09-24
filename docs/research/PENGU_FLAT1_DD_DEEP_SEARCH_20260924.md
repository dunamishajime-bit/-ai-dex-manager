# PENGU Flat1 DD Deep Search — 2026-09-24

## Fixed contract
All research in this report keeps the following fixed:
- Logic: COMBINED_FILTERED.
- PENGU maximum Gross: 1.0.
- Every PENGU entry Gross: 1.0.
- Existing causal entry routes/signals unchanged.
- Aster H1/funding replay; NORMAL/SEVERE inherited from the fixed research harness.
- Research only. No LIVE/VPS/orders changed.

Baseline flat1:
- Formal NORMAL +1307.91%, PF 3.979, DD -20.82%
- Formal SEVERE +769.78%, PF 3.147, DD -22.60%
- Rolling365 NORMAL +978.20%, PF 3.024, DD -32.17%
- Rolling365 SEVERE +550.88%, PF 2.437, DD -39.56%

Baseline max-DD clusters:
- Formal: V64 Long -8.14%, V64 Long -8.16%, Recovery V8 -6.14% consecutively.
- Rolling365: Jul-Sep 2026 repeated Recovery/Short/Long hard stops; DD -32.17%.

## Stage 1 — isolated controls
18 profiles were tested: route-specific hard stops, earlier trailing, Recovery defense, trend-fail exits, 48/72h loss cooldown.

Best isolated family was tighter hard stops.
HARD6_ALL (Long 6%, Short 6%, Recovery 5%):
- Formal NORMAL DD -16.16%, return +1230.34%
- Formal SEVERE DD -19.15%, return +715.79%
- Rolling365 NORMAL DD -24.95%, return +986.49%
- Rolling365 SEVERE DD -32.97%, return +551.36%

## Stage 2 — combined controls
18 combinations were tested around HARD6_ALL: 48/72h hard-stop cooldown, 2-loss streak cooldown, early Long/Short trailing, Recovery 48h, 4-5% breakeven locks.

Key findings:
- HARD5_ALL (Long 5%, Short 5%, Recovery 4.5%) materially improved DD:
  - Formal N: +1113.51%, DD -14.69%
  - Formal S: +643.75%, DD -17.73%
  - Rolling N: +926.11%, DD -20.53%
  - Rolling S: +514.99%, DD -28.98%
- Breakeven-at-4/5% variants reduced some giveback but destroyed too much compounding and were rejected.
- Recovery max-hold 48h degraded risk/return and was rejected.
- Early trailing protected DD but sacrificed too much return relative to hard-stop tuning.

## Stage 3 — route-specific hard-stop grid
60 combinations:
- Long stop: 4.0 / 4.5 / 5.0 / 5.5 / 6.0%
- Short stop: 4.5 / 5.0 / 5.5 / 6.0%
- Recovery stop: 4.0 / 4.5 / 5.0%

### DD-minimizing no-cooldown candidate
Long 4.0%, Short 4.5%, Recovery 4.0%:
- Formal N +1125.06%, DD -13.60%
- Formal S +650.89%, DD -16.67%
- Rolling N +967.96%, DD -17.02%
- Rolling S +540.27%, DD -25.43%
All three Formal folds remained positive; worst SEVERE fold DD -16.67%.

### Higher-profit candidate
Long 5.0%, Short 5.5%, Recovery 4.0%:
- Formal N +1421.70%, DD -14.41%
- Formal S +834.07%, DD -17.46%
- Rolling N +1187.93%, DD -20.20%
- Rolling S +673.10%, DD -28.31%
This exceeded flat1 baseline return in all four return comparisons while materially lowering DD.

## Stage 4 — lower grid + selective cooldown
27 lower-grid combinations plus selected 48/72h hard-stop cooldown and two-loss streak cooldowns.

### Maximum-DD reduction candidate
Long 4.0%, Short 4.5%, Recovery 4.0%, hard-stop cooldown 72h:
- Formal N +727.99%, DD -13.59%
- Formal S +439.24%, DD -16.66%
- Rolling N +645.87%, DD -13.59%
- Rolling S +378.60%, DD -17.82%
This has the lowest DD but removes too many trades (Rolling 65 vs baseline 74).

### DD-focused candidate with better return retention
Long 4.0%, Short 4.5%, Recovery 4.0%, hard-stop cooldown 48h:
- Formal N +1051.02%, DD -13.60%
- Formal S +620.28%, DD -16.67%
- Rolling N +867.82%, DD -13.60%
- Rolling S +500.63%, DD -21.41%
Rolling trade count 70 vs baseline 74.

### Strong no-cooldown lower-stop candidate
Long 3.5%, Short 4.5%, Recovery 4.0%:
- Formal N +1144.33%, DD -13.60%
- Formal S +662.79%, DD -16.67%
- Rolling N +990.41%, DD -16.59%
- Rolling S +553.83%, DD -25.04%
Rolling returns are slightly above the flat1 baseline while DD is sharply lower.

### Balanced selective-loss candidate
Long 4.0%, Short 5.0%, Recovery 4.0%, only after two consecutive losses -> 72h cooldown:
- Formal N +1245.94%, PF 4.262, DD -16.29%
- Formal S +707.85%, PF 3.237, DD -18.72%
- Rolling N +1121.63%, PF 3.637, DD -19.10%
- Rolling S +622.46%, PF 2.800, DD -25.76%
This preserves more opportunity than unconditional cooldown and beats baseline Rolling365 returns while reducing DD materially.

## Research interpretation
The major DD source is loss clustering, not insufficient gross diversification. With every PENGU entry fixed at 1.0, the effective DD controls are:
1. Tighten route-specific hard stops, especially Recovery.
2. Avoid unconditional breakeven/early trailing; it cuts too many winners.
3. If extra DD reduction is desired, cooldown should be selective after repeated losses rather than applied after every loss.
4. 72h cooldown after every hard stop achieves the lowest DD but has the largest opportunity cost.

## Candidate set for portfolio integration
Do not choose from PENGU standalone only. Carry these three into integrated V12/PENGU/Q102/FET/V52 replay:
- PROFIT: Long 5.0%, Short 5.5%, Recovery 4.0%, no extra cooldown.
- BALANCED: Long 4.0%, Short 5.0%, Recovery 4.0%, 2 consecutive losses -> 72h cooldown.
- DD_FOCUSED: Long 4.0%, Short 4.5%, Recovery 4.0%, hard-stop cooldown 48h.
Optional ultra-safe comparator:
- DD_MIN: Long 4.0%, Short 4.5%, Recovery 4.0%, hard-stop cooldown 72h.

## Validation
- Stage1 run: 35938759764 SUCCESS
- Stage2 run: 35938940219 SUCCESS
- Stage3 run: 35939492968 SUCCESS
- Stage4 run: 35939778518 SUCCESS
- Gross=1.0 / every entry=1.0 assertions passed in all profiles.
- No LIVE changes were made.
