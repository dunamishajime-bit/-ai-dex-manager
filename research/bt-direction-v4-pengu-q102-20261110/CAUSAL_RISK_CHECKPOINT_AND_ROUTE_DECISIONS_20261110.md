# DisDex Causal Risk Research Checkpoint — 2026-11-10

Status: **RESEARCH ONLY — NO PRODUCTION/LIVE CHANGE**

## Executive conclusion

The current research baseline still fails the owner objective: integrated max drawdown is **-50.37% at 10bps** and **-60.67% at 30bps**. No researched change reaches <=20% at both costs.

The most useful new finding is not a universal DD gate. The July–September drawdown decomposes across several runners, with the largest modeled arithmetic losses from PENGU, IDLE, Q102 and V4. Route-level removal tests show that the route with the clearest repeatable weakness is **IDLE_JUP_RELATIVE_SHORT**, but even removing it only improves the modeled DD to **-40.61% / -51.34%**. Therefore JUP is a real research target but is not the sole DD cause.

## Baseline

| Cost | Final JPY | Max DD | Win rate | Fills | PF |
|---|---:|---:|---:|---:|---:|
| 10bps | 2,111,834.84 | -50.37% | 60.45% | 852 | 1.229 |
| 30bps | 667,697.91 | -60.67% | 57.39% | 852 | 1.167 |

Caveats: V4 historical candidates still include V2 hindsight-shadow selection; V52 historical executable book is unavailable/approximated; IDLE is assumed active; modeled fills are not signed venue fills.

## Exact modeled peak-to-trough arithmetic attribution

10bps peak-to-trough modeled contributions:

- PENGU: -714,098 JPY
- IDLE: -673,321 JPY
- Q102: -631,041 JPY
- V4: -468,898 JPY
- RESIDUAL: -170,274 JPY
- HYPE: -59,724 JPY
- FET: +282,691 JPY
- V52: +390,456 JPY

The reconstruction matches the stored modeled equity snapshots exactly. This is accounting attribution, not causal proof.

## Route ablation results

| Research change | 10bps DD | 30bps DD | 10bps final | 30bps final | Decision |
|---|---:|---:|---:|---:|---|
| Remove IDLE JUP | **-40.61%** | **-51.34%** | **2,626,458** | **882,978** | UNRESOLVED — strongest route candidate |
| Remove PENGU V8 | -40.22% | -50.59% | 1,627,248 | 527,279 | REJECTED as removal |
| Remove PENGU V20 | -54.12% | -59.83% | 790,503 | 251,945 | REJECTED as removal |
| Remove IDLE TAO | -48.26% | -56.13% | 2,290,534 | 743,337 | UNRESOLVED |
| Remove IDLE RENDER | -57.20% | -65.92% | 1,826,682 | 586,103 | REJECTED |
| Remove V4 Y03 | -37.44% | -48.90% | 2,731,668 | 865,606 | UNRESOLVED; forward conflicts |
| Remove V4 Y06 | -47.38% | -58.11% | 2,160,371 | 677,454 | REJECTED as removal |
| Remove Q102 FET PB168 | -44.01% | -56.60% | 1,477,834 | 476,266 | REJECTED as removal |
| Remove Q102 AVAX MR24 | -49.45% | -59.79% | 2,125,219 | 674,498 | UNRESOLVED, no forward events |
| Remove Q102 UNI MR72 | -47.51% | -58.34% | 2,481,989 | 786,762 | UNRESOLVED, no forward events |
| Remove PENGU V8 + IDLE JUP | -34.20% | -37.95% | 1,959,697 | 674,146 | REJECTED as final solution; DD still high |
| Remove top three | -27.03% | -32.29% | 1,321,392 | 466,843 | REJECTED as final solution; DD still >20 and profit reduced |

These are ex-post diagnostics on the inspected historical drawdown. They are not automatically promotable rules.

## Temporal forward falsification (2026-10-01 to 2026-11-08)

This period is **not virgin OOS** for the frozen IDLE pin: commit `7688ed7c...` is dated **2026-10-24**. Use this only as temporal falsification, not certification.

| Route | N | 10bps WR | 10bps net sum | 30bps WR | 30bps net sum |
|---|---:|---:|---:|---:|---:|
| IDLE JUP SHORT | 16 | 43.75% | -9.54% | 43.75% | -12.74% |
| IDLE TAO SHORT | 8 | 50.00% | -3.40% | 50.00% | -5.00% |
| IDLE RENDER SHORT | 9 | 44.44% | +3.59% | 44.44% | +1.79% |
| PENGU V8 LONG | 4 | 75.00% | +5.29% | 75.00% | +4.49% |
| PENGU V20 SHORT | 6 | 33.33% | -3.46% | 33.33% | -4.66% |
| Q102 FET PB168 LONG | 3 | 66.67% | +1.26% | 66.67% | +0.66% |
| V4 Y03 SHORT | 2 | 100% | +2.19% | 100% | +1.79% |
| V4 Y06 SHORT | 20 | 65.00% | +53.43% | 65.00% | +49.43% |

## Direction checks

- **IDLE JUP**: forward native SHORT = 43.75% WR and negative; paired LONG = 56.25% WR and positive.
- **IDLE TAO**: forward SHORT is negative; paired LONG is positive, but only 8 events.
- **IDLE RENDER**: native SHORT is profitable; LONG flip is worse. Do not blanket-flip IDLE.
- **PENGU V20**: forward SHORT is weak, but simple LONG flip is materially worse. Direction correction must be conditional, not universal.
- **PENGU V8**: forward is profitable. Do not remove it based only on the historical DD episode.

## JUP-specific robustness

Historical JUP native sample: 58 signals. Native SHORT has >50% raw win rate at 10bps but negative mean return; the loss distribution is too large. Full LONG has positive mean but lower historical win rate.

A TRAIN-only single-feature screen produced one stable structural feature: JUP `volumeRatio >= 6.1027118433`. The threshold is the TRAIN-only 75th percentile, not PnL-optimized. Both BLOCK and LONG-FLIP passed two later historical slices and temporal forward falsification. ±20% threshold jitter also passed.

However integrated results show this micro-rule does **not** solve the portfolio DD:

| JUP rule | 10bps DD | 30bps DD | 10bps final | 30bps final |
|---|---:|---:|---:|---:|
| volume>=6.1 FLIP | -50.31% | -60.62% | 2,447,396 | 772,642 |
| volume>=6.1 BLOCK | -49.92% | -60.31% | 2,228,507 | 709,819 |

Therefore the volume rule is **REJECTED as a portfolio DD solution** despite route-level robustness.

## JUP Gross sensitivity

| JUP Gross | 10bps DD | 30bps DD | 10bps final | 30bps final |
|---|---:|---:|---:|---:|
| 1.00x baseline | -50.37% | -60.67% | 2,111,835 | 667,698 |
| 0.75x | -47.75% | -56.95% | 1,918,571 | 632,801 |
| 0.50x | -43.17% | -54.49% | 2,201,865 | 698,594 |
| 0.25x | **-41.52%** | **-51.72%** | **2,302,417** | **772,530** |
| 0x / route removed | **-40.61%** | **-51.34%** | **2,626,458** | **882,978** |

0.25x is a better fallback than 1.0x, but in this historical model full removal dominates it on DD, profit and modeled portfolio win rate. This remains post-hoc and cannot be promoted without cleaner separation.

## Research classification

- **IDLE JUP full removal / suspension:** `UNRESOLVED_DATA_OR_SEPARATION`. Strongest current candidate; needs a genuinely untouched period or source-before-test separation and current Production parity.
- **IDLE JUP 0.25x:** `UNRESOLVED_DATA_OR_SEPARATION`. Risk-reduction fallback; still DD >20%.
- **IDLE JUP always LONG:** `REJECTED` as final solution. Improves some route economics but integrated DD remains too high.
- **IDLE JUP volume>=6.1 selective FLIP/BLOCK:** `REJECTED` as portfolio solution.
- **PENGU V8 removal:** `REJECTED`.
- **PENGU V20 removal:** `REJECTED`.
- **PENGU V20 unconditional LONG flip:** `REJECTED`.
- **IDLE RENDER removal/flip:** `REJECTED`.
- **V4 Y06 removal:** `REJECTED`.
- **Q102 FET PB168 removal:** `REJECTED`.
- **IDLE TAO direction/risk change:** `UNRESOLVED_DATA_OR_SEPARATION`.
- **V4 Y03 removal:** `UNRESOLVED_DATA_OR_SEPARATION` because historical integrated improvement conflicts with positive but tiny forward sample.
- **Q102 AVAX MR24 / UNI MR72 removal:** `UNRESOLVED_DATA_OR_SEPARATION`.

## Next mandatory work

1. Rebuild clean V4 causal candidate generation so the historical V2 hindsight-filtered population no longer controls the integrated book.
2. Re-run the integrated portfolio with clean V4 source candidates and executable exit parity.
3. Keep JUP 0x and 0.25x as predeclared sensitivity cases, not selected winners.
4. Redesign PENGU V20 entry direction conditionally; do not remove or blindly flip.
5. Investigate IDLE TAO with the same time-split + paired-direction method.
6. Re-run exact DD attribution after each accepted causal candidate.
7. Do not change Production/LIVE until a candidate passes causal separation, 10bps/30bps profitability, win-rate checks and integrated DD validation.

Reproducibility archive SHA256: `18b3b8209ba330db918abc76eabcb2b4c1dff09620e92d4750e8258d79ad9ee1`.
