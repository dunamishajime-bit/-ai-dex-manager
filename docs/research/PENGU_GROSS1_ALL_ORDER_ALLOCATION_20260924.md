# PENGU Gross1 Fixed / All-Order Allocation BT — 2026-09-24

## Decision and scope
- PENGU **maximum Gross is fixed at 1.0** across every candidate. The target is pinned in `config/integratedProductionRiskPolicy.ts` **on this research/implementation-candidate branch only**.
- Preserve `COMBINED_FILTERED`: V64 Long, Short V20, Recovery V8, supplemental Long continuation, Short-exit reversal Long and filtered bullish rollover Short.
- Compare order-level sizing **within** the fixed 1.0 maximum. No global cap, Shared Gross, portfolio conflicts, venue margin or forced preemption has been replayed yet.
- Data: Aster Futures H1 + Aster funding; production feature/exit implementation sourced from commit `c6add8d39676584ad9db094d1ad04deb4050ed06`.
- NORMAL fee 6 bps per side. SEVERE fee 6 bps plus 35 bps additional adverse slippage per side, as inherited from Stage2.
- All selected results are backtests, not forecasts; the supplemental routes have sparse incremental samples.
- No Production merge, VPS deployment, position resize or LIVE activation.

## Allocation modes (all PENGU gross <= 1.0)
| Mode | V64 low | Recovery initial | Recovery partial | ATR floor | All entries |
|---|---:|---:|---:|---:|---|
| Current design cap1 | 0.1875 | 0.500000 | 0.250000 | 0.600000 | Variable |
| Low only scaled | 0.220588 | 0.500000 | 0.250000 | 0.600000 | Variable |
| Recovery only scaled | 0.1875 | 0.588235 | 0.294118 | 0.600000 | Variable |
| Low and Recovery | 0.220588 | 0.588235 | 0.294118 | 0.600000 | Variable |
| Uniform original-order x(1/0.85) | 0.220588 | 0.588235 | 0.294118 | 0.705882 | Variable (max1.0) |
| Flat all orders 1.0 | 1.000000 | 1.000000 | 0.500000 | N/A | 1.0 |

The Low+Recovery and uniform-original-order modes were identical for this sample because the extra ATR-floor adjustment changed no fill.

Short V20 sizing state (CAP/FLOOR/VOL_TARGET) is reclassified for each candidate, preserving corresponding exit behavior. Recovery partial defence is 50% of its **new** initial size, so 0.588235 -> 0.294118 + 0.294118 and 1.0 -> 0.5+0.5. Exit thresholds and signal/cooldown rules are unchanged.

## Formal 2025-08-10 to 2026-08-10
| Mode | NORMAL return | NORMAL WR | PF | DD | SEVERE return | SEVERE WR | SEVERE PF | SEVERE DD |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Current cap1 | 746.42% | 73.24% | 4.752 | -13.05% | 512.93% | 70.42% | 3.786 | -14.92% |
| Low only scaled | 748.85% | 73.24% | 4.724 | -13.05% | 513.98% | 70.42% | 3.766 | -14.92% |
| Recovery only scaled | 817.44% | 73.24% | 4.663 | -14.01% | 549.28% | 70.42% | 3.703 | -16.09% |
| Low and Recovery | 820.07% | 73.24% | 4.638 | -14.01% | 550.39% | 70.42% | 3.684 | -16.09% |
| Uniform original orders | 820.07% | 73.24% | 4.638 | -14.01% | 550.39% | 70.42% | 3.684 | -16.09% |
| Flat 1.0 all entries | 1307.91% | 73.24% | 3.979 | -20.82% | 769.78% | 70.42% | 3.147 | -22.60% |

## Rolling365 ending 2026-09-23 13:00 UTC
| Mode | NORMAL return | NORMAL WR | PF | DD | SEVERE return | SEVERE WR | SEVERE PF | SEVERE DD |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Current cap1 | 538.90% | 68.92% | 3.442 | -26.41% | 358.94% | 66.22% | 2.797 | -30.66% |
| Low only scaled | 543.46% | 68.92% | 3.427 | -26.37% | 361.36% | 66.22% | 2.786 | -30.65% |
| Recovery only scaled | 582.77% | 68.92% | 3.392 | -27.55% | 379.56% | 66.22% | 2.746 | -32.08% |
| Low and Recovery | 587.65% | 68.92% | 3.379 | -27.50% | 382.10% | 66.22% | 2.737 | -32.07% |
| Uniform original orders | 587.65% | 68.92% | 3.379 | -27.50% | 382.10% | 66.22% | 2.737 | -32.07% |
| Flat 1.0 all entries | 978.20% | 68.92% | 3.024 | -32.17% | 550.88% | 66.22% | 2.437 | -39.56% |

## Attribution and risk
- Formal 71 trades, Recovery V8 38 (five partial defences). Rolling365 74 trades, Recovery V8 37 (seven partial defences).
- Gross1 current design increases economic performance against prior 0.85 cap; changes to the *order distribution* yield further returns mainly by increasing Recovery V8 from 0.5 to 0.588235.
- Uniform scaling gives Formal NORMAL +73.64 pp and SEVERE +37.45 pp vs current cap1. Rolling365 NORMAL +48.75 pp and SEVERE +23.16 pp, at rolling SEVERE DD worsening from -30.66% to -32.07%.
- Flat1.0 all-orders increases returns substantially but brings rolling SEVERE DD close to -40% and worsens PF; do **not** promote this to LIVE merely from standalone results.
- Stage2's prior 2026-09-23 Long continuation remains in the rolling ledger; the added route is small relative to Recovery contribution.
- Winning percentage remains unchanged across all allocation modes because entry/exit timestamps and signs are identical. Changes in profit and DD do not validate any extra predictive edge.

## Validation
- New script: `scripts/research_pengu_gross1_all_orders_20260924.ts`.
- PENGU cap1 reference reconciliation passed against the preceding formal/rolling gross sweep in BOTH NORMAL and SEVERE.
- GitHub Actions run `35918886707` SUCCESS.
- This branch stages gross1 contract changes and updates contract assertions, without changing V64 lowGross or Recovery production configuration. No LIVE execution.
- **Portfolio integrated gross1 replay remains necessary** before Production activation: V12/Q102/FET/V52 competing use of Crypto normal3.0 / hard5.0 and Total normal4.25 / hard8.0, profit/DD and available-balance gates, pending-reservation conflicts and preemption. The existing September22 integrated results used PENGU cap0.85 and cannot be treated as a gross1 re-run.
