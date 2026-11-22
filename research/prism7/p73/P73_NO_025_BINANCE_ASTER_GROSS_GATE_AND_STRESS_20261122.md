# P73 | No gross 0.25: same UTC dual market score & macro market risk decisions

**Owner change**: If proposed Gross is 0.25 then do not enter; minimum accepted gross 0.5. Test no-trade 0.5 / 0.75 / 1.0 with original ASTER Native V20 source unchanged and Binance verified as time aligned context.

Gross 1.0 is only a research target; no live policy change. Original ASTER source 53, original single-slot33, 30bps and +100bps cover stress.

| Variant | Normal: closed/win | DD M5 | NAV | +100 cover DD | +100 NAV | Original source wins vetoed | Meets baseline NAV AND DD20 stress? |
|---|---:|---:|---:|---:|---:|---:|---|
| ORIGINAL_075 | 33/18 | 25.100289% | 14193.07 | 29.119242% | 11136.43 | 0 | False |
| ORIGINAL_100 | 33/18 | 32.113046% | 15557.46 | 37.112474% | 11254.4 | 0 | False |
| MACRO_BULL_VETO_075 | 27/15 | 17.024286% | 14314.22 | 19.954199% | 11752.28 | 8 | True |
| MACRO_BULL_HALF_ELSE_075 | 33/18 | 21.374307% | 14258.55 | 26.084989% | 11359.49 | 0 | False |
| MACRO_BULL_VETO_ELSE_100 | 27/15 | 22.065051% | 15790.77 | 25.832364% | 12138.2 | 8 | False |
| MACRO_BULL_HALF_ELSE_100 | 33/18 | 26.150809% | 15729.36 | 31.512939% | 11732.51 | 0 | False |
| SIGNED_NEGATIVE_VETO_ELSE_075 | 27/14 | 20.485095% | 11408.59 | 25.617187% | 9329.95 | 8 | False |
| SIGNED_NEGATIVE_HALF_ELSE_075 | 33/18 | 21.374307% | 13557.73 | 26.084989% | 10870.92 | 0 | False |
| SIGNED_LESS_MINUS6_VETO_ELSE_075 | 31/18 | 18.856387% | 15376.25 | 21.935859% | 12265.05 | 0 | False |
| SIGNED_LESS_MINUS6_HALF_ELSE_075 | 33/18 | 23.036583% | 14584.13 | 26.753227% | 11508.17 | 0 | False |
| MACRO_BULL_AND_NEGATIVE_VETO_ELSE_075 | 29/16 | 17.607732% | 14213.57 | 21.711969% | 11494.21 | 6 | False |
| MACRO_BULL_AND_NEGATIVE_HALF_ELSE_075 | 33/18 | 21.374307% | 14258.55 | 26.084989% | 11359.49 | 0 | False |
| MACRO_BULL_ELSE_HALF_IF_SCORE_NEG_ELSE_075 | 27/15 | 17.024286% | 13610.65 | 21.015753% | 11246.82 | 8 | False |
| MACRO_BULL_AND_PENGU_BOTH_W_UP_VETO_075 | 31/17 | 23.907577% | 13390.27 | 27.427671% | 10655.03 | 3 | False |
| MACRO_BULL_AND_PENGU_W_UP_VETO_075 | 31/17 | 23.907577% | 13390.27 | 27.427671% | 10655.03 | 3 | False |
| MACRO_BULL_UP_AND_PENGU_SIGNED_UP_VETO_ELSE_HALF | 31/18 | 17.103826% | 15032.99 | 21.223671% | 12106.59 | 0 | False |
| MACRO_BULL_REJECT_UNLESS_PENGU_REL_WEAK | 31/18 | 18.856387% | 15376.25 | 21.935859% | 12265.05 | 0 | False |
| MACRO_BULL_PENGU_WEAK_HALF_ELSE_REJECT | 30/18 | 15.490302% | 15683.87 | 17.569858% | 12702.33 | 2 | True |
| MACRO_BULL_VETO_ELSE_075_SCORE_GT12_ADD_TO_100 | 27/15 | 20.301529% | 15340.48 | 24.970297% | 12209.89 | 8 | False |

No threshold tuning for deployment based on this inspected source53. Research original Native profit exits remain pinned; early STOP5/8 is a different experiment and not folded into this score study.
