# V12 positive expectancy study — 2026-10-08

Result: **No adoptable V12 profitability repair found. No LIVE changes.**

Period 2025-08-10 to 2026-08-10 UTC. Initial capital JPY10,000, monthly contributions zero. Same corrected H1 quote proxy model, funding, quantity constraints, USD settlement/as-of ECB FX, ownership, strategy priorities and gross limits as the preceding research. Non-V12 source candidate streams are fixed; the previously compared Q102 RET14 delta remains in every case.

First screening: 9 gates × 7 exits × 3 entry modes =189 candidates. Zero passed. Expanded training-only screening:14 gates ×7 exits ×5 entry modes =490 unique variants including those first189 (not679 independent tests). Zero passed n>=80, price-only PF at30bps>=1.10, positive cumulative return after removing the best trade. No selection threshold was lowered. Top two distinct gate/entry modes were locked using first-half results as diagnostics only. They both fail full-year realized V12 profitability. Historical year was previously explored, so chronological checking is not an untouched holdout. Do not use this result as proof of future edge.

The 2h confirmation waits for favorable completed close >=0.1 original ATR and enters at next open. Pullback mode waits up to4h for an adverse completed close >=0.25ATR, followed by recovery >=0.1ATR; entry is subsequent H1 open. No later candle is used at the original entry price. Original ATR and risk-sized gross are frozen; sizing is not regenerated at the delayed entry. Simulation excludes pre-entry extrema in the first H2 trailing update. STOP wins if both stop/TP occur in the same H1. Replacement already crossed by next open exits at that open, not favorable newly computed stop.

The short pullback diagnostic improves normalized V12 returns at10/20bps but loses money in the actual compounding portfolio and second half. Larger portfolio equity is not V12 profitability. Prior WR60 control achieves V12 WR60.74% but PF0.932 and negative PnL. Reducing size is not evidence of a positive trading edge.

All realized ledgers, funding and fees, cash/event reconstruction, ownership and 280 quantity vectors pass independent audit for12 scenarios. Both control trade ledgers are byte-identical to prior ledgers at all3 costs. Seven synthetic causality/schema/gap tests pass; reviewer found no Critical/Important issues. MTM DD remains engine-reported, not independently reconstructed. Fixed candidate sources, observed-current venue filters, H1 execution and no tick/L2/pending-order replay limit realism. Temporal halves exclude boundary-crossing trades.

PnL below is USD settlement; legacy ledger field total_pnl_jpy stores USD. Portfolio final equity is JPY including initial capital. Unit mean = realized net USD / original entry notional. Compounding changes notional and accepted trades across cases/costs, so absolute PnL alone is not directly comparable.

| Case | Cost | V12 n | WR | PF USD | V12 PnL USD | Unit mean | First USD | Second USD | Portfolio JPY | MTM DD |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE_Q_RET14 | PRICE_MODEL_10BPS | 1123 | 40.25% | 0.720 | -4717.11 | -0.1188% | -182.51 | -4534.60 | 4319497.91 | 23.82% |
| BASELINE_Q_RET14 | PRICE_MODEL_20BPS | 1088 | 36.12% | 0.593 | -2499.34 | -0.2324% | -276.21 | -2223.13 | 1077420.15 | 24.62% |
| BASELINE_Q_RET14 | PRICE_MODEL_30BPS | 1070 | 32.43% | 0.489 | -1288.12 | -0.3359% | -298.28 | -989.84 | 274334.96 | 27.85% |
| DIAGNOSTIC_REL_ER_ARM2_T1_L2 | PRICE_MODEL_10BPS | 173 | 45.09% | 0.723 | -5120.09 | -0.0293% | 299.32 | -5419.41 | 9252514.03 | 27.34% |
| DIAGNOSTIC_REL_ER_ARM2_T1_L2 | PRICE_MODEL_20BPS | 173 | 45.09% | 0.692 | -3147.23 | -0.1281% | 186.05 | -3333.28 | 4406106.04 | 27.67% |
| DIAGNOSTIC_REL_ER_ARM2_T1_L2 | PRICE_MODEL_30BPS | 172 | 45.35% | 0.660 | -2258.68 | -0.2008% | 105.03 | -2363.71 | 2424146.02 | 28.00% |
| DIAGNOSTIC_SHORT_REL_TP15_S1_L4 | PRICE_MODEL_10BPS | 212 | 51.42% | 0.893 | -1574.22 | 0.1186% | 190.20 | -1769.99 | 13352687.37 | 19.69% |
| DIAGNOSTIC_SHORT_REL_TP15_S1_L4 | PRICE_MODEL_20BPS | 212 | 49.53% | 0.803 | -1813.21 | 0.0187% | 83.84 | -1900.48 | 7390923.71 | 20.20% |
| DIAGNOSTIC_SHORT_REL_TP15_S1_L4 | PRICE_MODEL_30BPS | 212 | 47.64% | 0.740 | -1426.08 | -0.0812% | 13.35 | -1441.39 | 3727864.52 | 20.74% |
| PRIOR_WR60 | PRICE_MODEL_10BPS | 787 | 60.74% | 0.932 | -772.99 | -0.0735% | -89.97 | -683.02 | 9591021.68 | 23.22% |
| PRIOR_WR60 | PRICE_MODEL_20BPS | 782 | 60.87% | 0.722 | -1830.49 | -0.1618% | -168.20 | -1662.29 | 4485309.20 | 24.36% |
| PRIOR_WR60 | PRICE_MODEL_30BPS | 776 | 59.15% | 0.550 | -1657.99 | -0.2611% | -199.87 | -1458.12 | 1967662.42 | 25.44% |

Reproduce from repository root (market archive from preceding study must be present):

```powershell
python scripts/research/run_v12_profit_study.py screen
python scripts/research/run_v12_profit_study.py run
python scripts/research/test_v12_profit_study.py
python scripts/research/verify_v12_profit_study.py
```

Next research needs a new V12 signal-generation hypothesis and fresh forward data rather than further picking thresholds from this historical year. No additional gate or deployment is justified by this study.
