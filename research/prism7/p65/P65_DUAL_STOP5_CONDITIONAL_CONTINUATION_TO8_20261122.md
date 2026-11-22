# P65 | PENGU V20 dual-level STOP: normally 5%, conditional carry to absolute 8%

Original source Native V20 53 price signals unchanged. +5% adverse SHORT standing STOP triggered by printed M5 high. Eligibility for carrying to maximum +8% decided ONLY with pre-trigger fully completed H1 & M5 data; +8% stop always modeled at M5 printed high, as well as original native exit/STOP. 0.75/1.0 Gross, 10/30bps, and 100bps cover stress.

Note: original source Native H1 exits, M5 touches, and actual venue orderbook STOP are NOT exactly reproducible; this is research price hybrid.

| Hold exception condition | Hold natural count | Gross | selected / wins | M5 DD | NAV yen | original winning sources lost |
|---|---:|---:|---:|---:|---:|
| NORMAL_STOP5_ALWAYS | 0 | 0.75 | 34/18 | 21.24567% | 15401.23 | 2 |
| NORMAL_STOP5_ALWAYS | 0 | 1.0 | 34/18 | 27.39723% | 17396.35 | 2 |
| EXCEPTION_HOLD8_ALWAYS | 19 | 0.75 | 33/18 | 25.13093% | 14184.44 | 0 |
| EXCEPTION_HOLD8_ALWAYS | 19 | 1.0 | 33/18 | 32.15092% | 15544.57 | 0 |
| EXCEPTION_BTC6_BEAR_AND_REL6_BEAR | 2 | 0.75 | 34/18 | 21.24567% | 15047.31 | 2 |
| EXCEPTION_BTC6_BEAR_AND_REL6_BEAR | 2 | 1.0 | 34/18 | 27.39723% | 16855.79 | 2 |
| EXCEPTION_BTC6_RISE_AND_REL24_WEAK | 5 | 0.75 | 33/18 | 21.24567% | 15411.77 | 0 |
| EXCEPTION_BTC6_RISE_AND_REL24_WEAK | 5 | 1.0 | 33/18 | 27.39723% | 17409.86 | 0 |
| EXCEPTION_REL24_WEAK_AND_BELOW_EMA72 | 5 | 0.75 | 33/18 | 21.24567% | 15411.77 | 1 |
| EXCEPTION_REL24_WEAK_AND_BELOW_EMA72 | 5 | 1.0 | 33/18 | 27.39723% | 17409.86 | 1 |
| EXCEPTION_REL24_WEAK_AND_M5_PRINTS_GE3 | 5 | 0.75 | 33/18 | 21.24567% | 15411.77 | 0 |
| EXCEPTION_REL24_WEAK_AND_M5_PRINTS_GE3 | 5 | 1.0 | 33/18 | 27.39723% | 17409.86 | 0 |
| EXCEPTION_LAST_H1_BEAR_AND_REL24_WEAK | 1 | 0.75 | 34/18 | 21.24567% | 15401.23 | 2 |
| EXCEPTION_LAST_H1_BEAR_AND_REL24_WEAK | 1 | 1.0 | 34/18 | 27.39723% | 17396.35 | 2 |
| EXCEPTION_PRIOR_M5_FAVORABLE1_AND_LAST_H1_BEAR | 1 | 0.75 | 34/18 | 21.24567% | 15401.23 | 2 |
| EXCEPTION_PRIOR_M5_FAVORABLE1_AND_LAST_H1_BEAR | 1 | 1.0 | 34/18 | 27.39723% | 17396.35 | 2 |
| EXCEPTION_M5_SELLER_RATIO60_AND_BTC6_BEAR | 1 | 0.75 | 34/18 | 21.24567% | 15401.23 | 2 |
| EXCEPTION_M5_SELLER_RATIO60_AND_BTC6_BEAR | 1 | 1.0 | 34/18 | 27.39723% | 17396.35 | 2 |
| EXCEPTION_PRIOR_M5_FAVORABLE2_AND_REL24_WEAK | 3 | 0.75 | 34/18 | 21.24567% | 15401.23 | 1 |
| EXCEPTION_PRIOR_M5_FAVORABLE2_AND_REL24_WEAK | 3 | 1.0 | 34/18 | 27.39723% | 17396.35 | 1 |
| EXCEPTION_BTC6_RISE_REL24_WEAK_LAST_H1_BEAR | 0 | 0.75 | 34/18 | 21.24567% | 15401.23 | 2 |
| EXCEPTION_BTC6_RISE_REL24_WEAK_LAST_H1_BEAR | 0 | 1.0 | 34/18 | 27.39723% | 17396.35 | 2 |
| EXCEPTION_LAST3_H1_2BEAR_BELOW_EMA72 | 2 | 0.75 | 34/18 | 21.24567% | 15401.23 | 2 |
| EXCEPTION_LAST3_H1_2BEAR_BELOW_EMA72 | 2 | 1.0 | 34/18 | 27.39723% | 17396.35 | 2 |
| EXCEPTION_BTC6_BEAR_AND_EMA72_BEAR | 5 | 0.75 | 34/18 | 21.24567% | 15521.28 | 2 |
| EXCEPTION_BTC6_BEAR_AND_EMA72_BEAR | 5 | 1.0 | 34/18 | 27.39723% | 17573.59 | 2 |

Do not use hindsight knowledge of whether the original native signal would win. All examples are drawn from already-reviewed 53 natural intents, which overlap. Even if a conditional gate looks promising, do NOT change LIVE STOP or Gross until exact fill/STOP replay plus independent venue data.
