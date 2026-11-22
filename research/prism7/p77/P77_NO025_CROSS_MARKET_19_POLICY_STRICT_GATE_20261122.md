# P77 — Gross0.25 excluded; same-calendar Aster+Binance signed points / DD20 & profit final decision

**Conclusion: 19 entry-risk policies use only veto, gross0.5,0.75,1.0. NONE met both venue source models simultaneously with no lower NAV and 30bps+extra100bps buy-cover DD <=20%. No live adoption.**

Aster Native53 original baseline 33 one-slot 18 wins NAV ¥14193.07; Binance Native62 same Aster first-last entry window baseline 35 one-slot20 wins NAV ¥17769.89. In the full Aug1-Nov14 Binance source baseline 38/21.

| Entry policy | Aster closed / NAV | Aster DD+100bps | Binance exact Aster window closed / NAV | Binance DD+100bps | Both pass? |
|---|---:|---:|---:|---:|---:|
| ORIGINAL_075 | 33/14193.07 | 29.119242% | 35/17769.89 | 29.555625% | False |
| ORIGINAL_100 | 33/15557.46 | 37.112474% | 35/21004.73 | 35.266469% | False |
| MACRO_BULL_VETO_075 | 27/14314.22 | 19.954199% | 27/14961.75 | 17.092218% | False |
| MACRO_BULL_HALF_ELSE_075 | 33/14258.55 | 26.084989% | 35/16822.68 | 22.510282% | False |
| MACRO_BULL_VETO_ELSE_100 | 27/15790.77 | 25.832364% | 27/16783.76 | 22.071394% | False |
| MACRO_BULL_HALF_ELSE_100 | 33/15729.36 | 31.512939% | 35/18871.31 | 24.630648% | False |
| SIGNED_NEGATIVE_VETO_ELSE_075 | 27/11408.59 | 25.617187% | 29/14502.53 | 18.405349% | False |
| SIGNED_NEGATIVE_HALF_ELSE_075 | 33/13557.73 | 26.084989% | 35/16659.41 | 22.510282% | False |
| SIGNED_LESS_MINUS6_VETO_ELSE_075 | 31/15376.25 | 21.935859% | 32/19586.12 | 29.555625% | False |
| SIGNED_LESS_MINUS6_HALF_ELSE_075 | 33/14584.13 | 26.753227% | 35/18365.37 | 29.555625% | False |
| MACRO_BULL_AND_NEGATIVE_VETO_ELSE_075 | 29/14213.57 | 21.711969% | 30/15472.49 | 18.405349% | False |
| MACRO_BULL_AND_NEGATIVE_HALF_ELSE_075 | 33/14258.55 | 26.084989% | 35/17014.96 | 22.510282% | False |
| MACRO_BULL_ELSE_HALF_IF_SCORE_NEG_ELSE_075 | 27/13610.65 | 21.015753% | 27/14649.1 | 17.092218% | False |
| MACRO_BULL_AND_PENGU_BOTH_W_UP_VETO_075 | 31/13390.27 | 27.427671% | 32/17047.71 | 29.555625% | False |
| MACRO_BULL_AND_PENGU_W_UP_VETO_075 | 31/13390.27 | 27.427671% | 32/17047.71 | 29.555625% | False |
| MACRO_BULL_UP_AND_PENGU_SIGNED_UP_VETO_ELSE_HALF | 31/15032.99 | 21.223671% | 34/17857.29 | 22.510282% | False |
| MACRO_BULL_REJECT_UNLESS_PENGU_REL_WEAK | 31/15376.25 | 21.935859% | 33/19753.52 | 29.555625% | False |
| MACRO_BULL_PENGU_WEAK_HALF_ELSE_REJECT | 30/15683.87 | 17.569858% | 30/15949.71 | 16.669811% | False |
| MACRO_BULL_VETO_ELSE_075_SCORE_GT12_ADD_TO_100 | 27/15340.48 | 24.970297% | 27/15657.65 | 21.094323% | False |

Aster best exploratory macro bull + relative PENGU weakness: 30 trades 18 wins, normal M5 DD15.49%, NAV ¥15,683.87, stressed DD17.57%. Binance strictly matched calendar: 30 trades 18 wins, DD14.73%, NAV ¥15,949.71 versus original ¥17,769.89; fails profit retention even though stress DD16.67%. Binance full Aug1-Nov14 33/19, DD18.95%, NAV ¥14,574 versus original ¥16,237, stress DD21.57%.

Exact matching entry hours: Aster Native53 and Binance Native62 fire simultaneously in 27 hours: 15 both win, 12 both lose, zero mixed. Signed score identical at each hour; 25 exit hour identical, remaining two differ by one hour. Native return correlation 0.99922 on these 27 paired price-source trades, so NOT independent outcome sets.

H1 close-price market similarities: {'PENGUUSDT': {'hourlyOverlapCount': 11376, 'medianAbsoluteH1CloseSpreadPct': 0.155521, 'p95AbsH1CloseSpreadPct': 0.823529, 'p99AbsH1CloseSpreadPct': 1.474087, 'maxAbsH1CloseSpreadPct': 9.164368, 'H1ReturnCorrelation': 0.901653, 'hoursWithAbsH1CloseSpreadOver1pct': 342}, 'BTCUSDT': {'hourlyOverlapCount': 11376, 'medianAbsoluteH1CloseSpreadPct': 0.005603, 'p95AbsH1CloseSpreadPct': 0.036449, 'p99AbsH1CloseSpreadPct': 0.087501, 'maxAbsH1CloseSpreadPct': 0.338974, 'H1ReturnCorrelation': 0.999244, 'hoursWithAbsH1CloseSpreadOver1pct': 0}}

**Risk interpretation:** changing gross from0.25 to 0.5 improves trade significance but must not be accepted merely for low DD. Full trade retention/expected growth and realistic +100bps DD <=20% are both requirements. Some no-entry vetoes remove original winning signals; the original V20 is strongly profitable in some systemic bull environments. Gross1 is not defensible currently.

**Research next:** fix market trend as signed score but use ASTER/Binance agreement / spread divergence as confidence, NOT doubled same PENGU/BTC trend points. Distinguish systemic BTC/ETH weekly/daily bull from PENGU 12H remaining downside and 4H/1H rebound rejection, then test on truly fresh Aster period/market with Native full stop execution, fees, funding, shared risk. Code changes and trading permissions remain zero.
