# Final Integrated Logic + V52 Validation — 2026-09-17

Status: **RESEARCH_ONLY**. No LIVE order, VPS mutation, production runtime change, approval change, Kill Switch change, or position/order change was made by this research.

Base commit: `bd5c731c966f41c38748433156062d579e45b6fc`
Research branch: `research/v52-final-validated-20260917`
Period: `2025-08-10T00:00:00Z` to `2026-08-10T00:00:00Z`
Capital: initial ¥10,000 + ¥10,000 monthly x12 = total contributed ¥130,000, compounding enabled.

## Baseline parity

The formal baseline was re-run before comparing any V52 change.

- NORMAL: ending asset **¥18,442,769.04**, PF **3.57064393**, DD **-14.33740242%**, executions **1,181**.
- SEVERE: ending asset **¥2,827,282.14**, PF **2.41551514**, DD **-17.68170098%**, executions **1,048**.
- Formal logic source: `docs/research-results/v12-btc2-q54-atr14-pengu-hard24-q102x1.json`.
- Baseline parity assertions passed before candidate comparison.

## Final integrated architecture

| Sleeve / control | Final research target |
|---|---|
| V12 | Top2, 2 slots, 1.00x per position, 1.50x aggregate |
| V12 regime | BTC 2.0%, strong 3.59%, relaxed momentum 5.4%, ATR ratio 1.4%, score 1.4649 |
| PENGU | research ledger `PENGU_DUAL_LS_V2_RECOVERY_V8`, allocation cap **0.85x**, hard-stop cooldown **24h** |
| Q102 | production target `Q102_CAUSAL_V4`, **1.50x**, 1 slot |
| V52 V11 | unchanged |
| V52 V50 | B60 / convergence20 / stop1.75 / min net edge7.5 |
| V52 cost gates | max round-trip cost **60bps**, max spread **20bps** — unchanged |
| Stock gross | **1.50x** |
| Crypto gross | **3.00x** |
| Total gross | **3.50x** |
| Shared crypto daily loss | **7.5%** |
| Stock daily loss | **3.5%** |
| Venue margin | **5x Cross**; 3.5x total gross implies max simple initial-margin fraction 70% |

## V52 change selected

Production V52 currently uses V11 + V50 basis convergence. The selected V50 research change is intentionally narrow:

| Parameter | Current | Selected |
|---|---:|---:|
| Minimum entry basis | 75bps | **60bps** |
| Convergence exit | 15bps | **20bps** |
| Basis stop multiple | 1.50x | **1.75x** |
| Minimum net edge | 10bps | **7.5bps** |
| Maximum round-trip cost | 60bps | **60bps unchanged** |
| Maximum spread | 20bps | **20bps unchanged** |
| Windows | POST_EARLY3 | unchanged |
| Maximum hold | 3h | unchanged |
| Direction | BOTH | unchanged |

V11 remains unchanged. The change does not force entries above the existing 60bps observable-cost boundary and does not weaken the 20bps spread gate.

The B60 threshold was preferred over B50: the fine sweep produced the same integrated 40/44/60bps result for the top family while B60 reduced raw V50 candidates from 249 to 208 and produced the stronger 24bps result.

## Final combined BT

| Scenario | Before V52 improvement | Final all-logic candidate | PF | DD | Executions |
|---|---:|---:|---:|---:|---:|
| NORMAL / 40bps | ¥66,059,488.04 | **¥69,373,656.14** | **3.70258068** | **-17.59935397%** | 1,165 |
| SEVERE / 100bps stock cost | ¥8,729,157.74 | **¥8,729,157.74** | **2.62470185** | **-19.24473938%** | 1,023 |

At 40bps, the V52 change adds **+5.0169%** to ending asset versus the already-selected crypto sizing configuration. At 100bps, V52 remains Fail Closed with **0 V52 trades**, so the SEVERE result is intentionally unchanged.

### NORMAL sleeve attribution — final all-logic candidate

| Sleeve | Trades | PnL | PF |
|---|---:|---:|---:|
| V12 | 874 | **+¥28,176,454.53** | 2.76544602 |
| PENGU | 66 | **+¥8,951,870.37** | 4.56779938 |
| V52 | 143 | **+¥9,330,664.33** | 4.97991626 |
| Q102 | 82 accounting events | **+¥22,784,666.90** | 4.24074293 |

### SEVERE sleeve attribution

| Sleeve | Trades | PnL | PF |
|---|---:|---:|---:|
| V12 | 871 | **+¥2,544,693.04** | 1.59607577 |
| PENGU | 66 | **+¥1,673,441.04** | 3.63716344 |
| V52 | 0 | ¥0 | N/A — 100bps cost is above the 60bps Fail-Closed gate |
| Q102 | 86 accounting events | **+¥4,381,023.66** | 4.06997890 |

## V52 cost sensitivity inside the selected all-logic architecture

| Stock round-trip cost | Baseline V52 logic | Selected V52 logic | Final PF | Final DD | V52 PnL |
|---|---:|---:|---:|---:|---:|
| 24bps | ¥77,156,180.72 | **¥81,065,059.92** | 3.79345336 | -17.33097423% | +¥14,292,921.70 |
| 40bps | ¥66,059,488.04 | **¥69,373,656.14** | 3.70258068 | -17.59935397% | +¥9,330,664.33 |
| 44bps | ¥63,672,250.12 | **¥66,554,577.53** | 3.68854838 | -17.66638072% | +¥8,788,476.09 |
| 60bps | ¥51,803,650.69 | **¥53,483,733.78** | 3.58040190 | -17.93421503% | +¥4,324,532.09 |

The selected V52 logic improves ending asset at every observable cost point tested. The 60bps gate itself was not relaxed.

## Robustness checks

### Leave-one-month-out

For each calendar month present in the one-year window, all V52 entries from that month were removed from both baseline and candidate and the integrated portfolio was re-run without retuning.

- Current formal architecture: candidate beat baseline in **every omitted-month run**; improvement range **+2.9147% to +5.8024%**.
- Selected crypto architecture: candidate beat baseline in **every omitted-month run**; improvement range **+3.0140% to +5.9122%**.
- `allLomoPositive = true` for both architectures.

This reduces the risk that the result is explained by one exceptional month.

### Monthly V52 behavior at 40bps — selected crypto architecture

There were V52 exits in 11 active calendar months. Candidate V52 PnL was positive in **10/11** active months. May 2026 remained negative, but improved from **-¥387,752** to **-¥304,596**. Candidate-minus-baseline monthly PnL was positive in 9/11 active months; the two lower-delta months were October 2025 and June 2026, both of which still had positive candidate V52 PnL.

### Stop 1.75 audit

Holding all other selected V50 rules fixed and comparing stop 1.50 vs 1.75 at 40bps:

- Raw V50 candidates: 208 vs 208.
- Accepted trades whose exit outcome changed: **4**.
- Improved changed trades: **4**.
- Worsened changed trades: **0**.
- Sum of raw net-return deltas across changed trades: **+0.0487666**.
- Current formal integrated ending asset: ¥19,261,339.91 -> **¥19,348,152.48** (+0.4507%), DD unchanged at -14.1958%.
- Selected crypto integrated ending asset: ¥69,060,075.48 -> **¥69,373,656.14** (+0.4541%), DD unchanged at -17.5994%.

## Current-formal architecture cross-check

The V52 candidate was also tested without adopting the higher crypto gross settings:

- NORMAL 40bps: **¥18,442,769.04 -> ¥19,348,152.48 (+4.9092%)**.
- PF: 3.57064393 baseline formal -> **3.58696725** with the V52 candidate.
- DD: **-14.3374% -> -14.1958%**.
- V52 PnL: **+¥2,229,183 -> +¥2,636,545 (+18.274%)**.
- SEVERE 100bps: **¥2,827,282.14 unchanged**, because V52 remains Fail Closed.

## Selection conclusion

The final research target is therefore:

`V12 formal logic + PENGU allocation 0.85x + Q102 1.50x/1 slot + V52(V11 unchanged, V50 B60/C20/Stop1.75/Edge7.5) + Crypto Gross 3.0x + Stock Gross 1.5x + Total Gross 3.5x + Shared crypto daily loss 7.5% + Aster 5x Cross`.

This is a research selection, not a direct deployment artifact. The result was optimized and evaluated on one one-year historical window, so production implementation must preserve fail-closed gates and pass exact parity/CI/preflight checks before any LIVE activation.

The 100bps stock SEVERE case does **not** mean V52 trades safely at 100bps. It confirms the intended behavior: because 100bps exceeds the 60bps observable-cost limit, V52 sends no entry and contributes zero PnL.

The 3.5x total gross cap at 5x Cross corresponds to a simple 70% initial-margin fraction at maximum simultaneous gross. Production implementation must independently verify Aster maintenance-margin/liquidation buffer and current venue tier rules before allowing the higher shared caps.

## Evidence files

- `v52-logic-sweep-stage1-20260917.json` — 162 predefined V50 candidate sweep.
- `v52-logic-sweep-stage2-20260917.json` — exit / stop / edge refinement.
- `v52-logic-sweep-stage3-20260917.json` — fine boundary sweep.
- `v52-final-validated-logic-20260917.json` — final integrated architecture, baseline parity, cost sensitivity, sleeve results.
- `v52-final-robustness-20260917.json` — monthly, leave-one-month-out, and stop audit.

Safety state for all evidence: `RESEARCH_ONLY`, `ordersSent=false`, `liveChanged=false`, `vpsChanged=false`, `productionChanged=false`.
