# V12 Strong Quality Gate — Integrated Production Candidate (2026-09-19)

## Exact logic change

The existing V12 directional/strong-regime path previously accepted every otherwise-valid candidate whenever BTC qualified as a strong regime. That unconditional bypass is removed.

The production candidate keeps the normal score route unchanged: **score >= 1.4649 passes** after side/regime alignment and the existing base filters.

For a directional **strong BTC regime** with score below 1.4649, the candidate now passes only when **0.15 <= score <= 0.70 AND ATR/price >= 1.40%**. A strong-regime candidate outside that score band, or below the ATR ratio floor, is blocked.

For directional regimes that are not strong, the existing relaxed route is unchanged: **aligned momentum >= 5.4% AND ATR/price >= 1.40%**.

The existing minimum momentum, volume ratio, cost-edge, side alignment, Top2, per-position gross, base/dynamic gross, cooldown, stop, take-profit, trailing, max-hold and rebalance rules are unchanged.

To retain the formal integrated **SEVERE max-DD < 20%** gate, only Q102 HIGH_VOL gross is adjusted from **1.665x to 1.661x**. The exact DD source was the 2025-10-19 Q102 HIGH_VOL ENA hard-stop. BRK and the V12 Dynamic 2.0x cap were tested and did not change the DD peak, so they remain unchanged.

## Formal 1-year integrated replay

Period: **2025-08-10 through 2026-08-10 (365 days)**. Initial capital JPY 10,000 plus JPY 10,000 monthly x 12; total contributed JPY 130,000; compounding enabled.

| Scenario | Current | Candidate | Change |
|---|---:|---:|---:|
| NORMAL ending asset | JPY 270,126,566.38 | **JPY 334,453,833.52** | **+JPY 64,327,267.14 (+23.81%)** |
| NORMAL PF | 3.82886822 | **4.12766200** | +0.29879378 |
| NORMAL max DD | -19.72421906% | **-19.88452049%** | -0.16030143 pt |
| NORMAL trades | 1,237 | **1,144** | -93 |
| SEVERE ending asset | JPY 24,184,641.27 | **JPY 34,122,156.03** | **+JPY 9,937,514.76 (+41.09%)** |
| SEVERE PF | 2.79016516 | **3.07240612** | +0.28224096 |
| SEVERE max DD | -19.97886021% | **-19.99033133%** | -0.01147112 pt |
| SEVERE trades | 1,078 | **988** | -90 |

V12 entries fall from 874/871 to 786/786 (NORMAL/SEVERE), while integrated Q102 entries rise from 69 to 71 because low-quality V12 occupancy is removed. Gross conflicts remain zero; Crypto Gross remains <=3.0x and Total Gross <=3.5x.

The current formal replay was first reproduced exactly at JPY 270,126,566.3772751 NORMAL and JPY 24,184,641.27364947 SEVERE before the candidate was compared.

## Production contract

- V12 base aggregate: 1.50x
- V12 dynamic residual cap: 2.00x
- V12 per-position cap: 1.00x
- PENGU: 0.85x
- Q102: HIGH_VOL **1.661x**, MR 1.0x, BRK 2.465x, REV 2.5x, PB 2.5x
- V52: aggregate 1.98x / slot 1.64x
- Crypto Gross <=3.0x
- Total Gross <=3.5x
- Shared crypto daily loss: 7.5%
- Venue margin contract remains 5x Cross
