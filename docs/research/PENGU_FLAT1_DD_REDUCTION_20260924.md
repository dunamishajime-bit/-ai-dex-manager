# PENGU COMBINED_FILTERED / Flat Gross 1.0 DD Reduction — 2026-09-24

## Fixed contract
- Logic: COMBINED_FILTERED
- PENGU maximum Gross: 1.0
- Every PENGU entry Gross: 1.0
- Entry signals: unchanged
- Normal fees: 6 bps/side
- Severe: 6 bps/side + 35 bps adverse slippage/side
- Research only; no LIVE/VPS/order changes

## Baseline flat1 decomposition

Formal 2025-08-10 to 2026-08-10:
- NORMAL return +1307.91%, PF 3.979, DD -20.82%
- SEVERE return +769.78%, PF 3.147, DD -22.60%
- Max-DD episode: 2025-11-07 to 2025-11-13
  - BASE_V64_LONG hard stop -8.14%
  - BASE_V64_LONG hard stop -8.16%
  - RECOVERY_V8 hard stop -6.14%
- Three consecutive losses drove the peak-to-trough event.

Rolling365:
- NORMAL return +978.20%, PF 3.024, DD -32.17%
- SEVERE return +550.88%, PF 2.437, DD -39.56%
- Route standalone DD:
  - BASE_V64_LONG ~ -22.52%
  - RECOVERY_V8 ~ -20.43%
  - SHORT_V20 ~ -21.40%
- Largest loss families are hard stops:
  - BASE_V64_LONG hard stops: 5 losses / -40.75% summed account-return units
  - Recovery V8 hard stops: 7 losses / -38.07%
  - Short V20 hard stops: 4 losses / -29.97%

## Route protection sweep
Tighter route exits were not selected:
- V64 hard6 / trail8-3 improved Formal but worsened Rolling DD and return.
- Recovery early defense hard5 / partial12h -3 / trail5-2.5 worsened return and Rolling DD.
- Short hard6 / trail10-3 reduced Rolling DD but reduced return materially.
- Combined tighter exits over-traded and degraded both return and DD.

The strongest mechanism was **post-hard-stop cooldown**, not tighter stops.

## Hard-stop cooldown sweep

### Formal one year
| Hard-stop cooldown | NORMAL return | PF | DD | SEVERE return | SEVERE PF | SEVERE DD |
|---|---:|---:|---:|---:|---:|---:|
| 24h baseline | 1307.91% | 3.979 | -20.82% | 769.78% | 3.147 | -22.60% |
| 36h | **1374.98%** | **4.227** | **-18.46%** | **817.97%** | **3.335** | **-21.39%** |
| 48h | 1302.36% | 4.240 | -18.46% | 778.64% | 3.335 | -21.39% |
| 60h | 1237.89% | 4.357 | -15.05% | 755.84% | 3.432 | -16.99% |
| 72h | 1235.23% | 4.443 | -14.52% | 760.16% | 3.511 | -16.99% |

### Rolling365
| Hard-stop cooldown | NORMAL return | PF | DD | SEVERE return | SEVERE PF | SEVERE DD |
|---|---:|---:|---:|---:|---:|---:|
| 24h baseline | 978.20% | 3.024 | -32.17% | 550.88% | 2.437 | -39.56% |
| 36h | **1025.73%** | **3.289** | **-26.68%** | **594.31%** | **2.640** | **-34.17%** |
| 48h | 970.30% | 3.282 | -26.68% | 564.56% | 2.629 | -34.17% |
| 60h | 921.10% | 3.331 | **-21.73%** | 547.31% | 2.675 | **-29.20%** |
| 72h | 896.60% | 3.350 | -31.66% | 531.69% | 2.680 | -38.24% |

## Hybrid route cooldown check
36h for all hard stops remained strongest balanced candidate.

- Base Long 48 / Recovery36 / Short36:
  - Formal NORMAL +1311.22%, DD -18.46%
  - Rolling NORMAL +977.06%, DD -26.68%
- Base36 / Recovery36 / Short48:
  - identical to ALL36 for this sample
- Base48 / Recovery36 / Short48 or Short60:
  - no further DD improvement; return lower than ALL36

Therefore selective extensions do not beat the simple 36h all-hard-stop rule in the available sample.

## Selected research candidate
**COMBINED_FILTERED + every order Gross 1.0 + hard-stop cooldown 36h**

Relative to Flat1 24h baseline:
- Formal NORMAL: +67.07 pp return, DD improves 2.36 pp
- Formal SEVERE: +48.19 pp return, DD improves 1.21 pp
- Rolling365 NORMAL: +47.52 pp return, DD improves 5.49 pp
- Rolling365 SEVERE: +43.43 pp return, DD improves 5.39 pp
- Max consecutive losses falls from 3 to 2
- Trade count falls only 1 in Formal and 3 in Rolling365
- Gross remains exactly 1.0 for every executed PENGU entry

60h is retained only as a DD-priority alternative:
- Rolling NORMAL DD -21.73%
- Rolling SEVERE DD -29.20%
but it sacrifices return versus 36h.

## Validation
- DD decomposition run: 35925793280 SUCCESS
- Cooldown sweep run: 35926234530 SUCCESS
- Hybrid cooldown run: 35926619409 SUCCESS
- Every candidate asserts all executed PENGU entries have requestedGross == 1.0
- Baseline flat1 parity assertions passed
- No LIVE activation or Production deployment was performed
