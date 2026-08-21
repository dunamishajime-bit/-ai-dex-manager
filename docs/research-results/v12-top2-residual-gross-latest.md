# V12 Top2 Residual Gross — frozen offline BT

- Artifact/run: `v12-top2-residual-gross-32482853308`
- Source branch: `codex/v12-top2-residual-gross-20260821`
- Period: `2025-08-10T00:00:00Z` (inclusive) → `2026-08-10T00:00:00Z` (exclusive), 365 days
- Status: `PASS_RESEARCH_ONLY`
- Source ledger: frozen V12 lineage `27f023a37d08b71c6e59b797fdc03c20d6032da2`

| Variant | Normal return | Normal PF | Normal DD | Stress return | Stress PF | Stress DD | V12 trades N/S |
|---|---:|---:|---:|---:|---:|---:|---:|
| CURRENT_ONE_SLOT | +911.5876% | 3.3310 | -12.0739% | +189.4744% | 2.1513 | -16.2720% | 218 / 175 |
| TOP2_AGGREGATE_1.00 | +911.5876% | 3.3310 | -12.0739% | +189.4744% | 2.1513 | -16.2720% | 218 / 175 |
| TOP2_AGGREGATE_1.25 | +911.5876% | 3.3310 | -12.0739% | +189.4744% | 2.1513 | -16.2720% | 218 / 175 |
| TOP2_AGGREGATE_1.50 | +911.5876% | 3.3310 | -12.0739% | +189.4744% | 2.1513 | -16.2720% | 218 / 175 |

Observed gross maxima: V12 1.00, PENGU 0.75, crypto 1.50, stock 1.50, total portfolio 2.50. All cap checks passed. The frozen ledger had no overlapping rank-2 candidates, so no synthetic or future/shadow trades were added; identical rows are an observed ablation result, not a claim that rank-2 was active in this period.

This is research-only and is not an untouched holdout. It sent zero orders and changed no VPS, LIVE, kill-switch, position, or production state. Drawdown is closed-event equity because synchronized intratrade MTM was not available in the ledger.
