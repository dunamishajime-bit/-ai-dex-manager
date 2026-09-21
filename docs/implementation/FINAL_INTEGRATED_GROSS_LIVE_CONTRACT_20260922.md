# Final Integrated Gross LIVE Contract — 2026-09-22

This document is the implementation and acceptance contract for the final integrated DisDex LIVE logic.

## Strategy allocation contract

- V12: Top3, Rank3 0.10x when score >= 0.70, base/dynamic aggregate cap 2.00x, per-position cap 1.00x.
- PENGU: maximum gross 0.85x.
- FET BRK48 residual: maximum gross 2.25x, lower priority than core logic and preemptible by core entries.
- Q102 Causal V4: one slot, family gross unchanged, DD governor boost maximum 3.00x.
- V52/V50 stock sleeve: stock aggregate gross 4.00x, slot gross 2.00x.
- Venue requirement: Aster 5x Cross.

## Portfolio gross contract

Normal entry caps:
- Crypto Gross: 3.00x.
- Total Gross: 4.25x.

Absolute hard ceilings:
- Crypto Gross: 5.00x.
- Total Gross: 8.00x.

The hard ceilings are not target utilization. New exposure above the normal caps is admitted only by the integrated profit/DD/margin governor. Existing valid positions are not force-trimmed merely because the effective entry cap falls after admission.

Fail-closed behavior:
- Missing or stale DD/profit evidence => normal caps only.
- Missing available-balance evidence => normal caps only.
- Any requested entry cap above a hard ceiling => reject.
- Margin-derived capacity can only reduce the effective entry cap.
- Existing exposure above a newly reduced effective cap blocks additional exposure but does not itself trigger forced liquidation.

Profit tiers:
- PROFIT_1: TWR >= 1.05 and DD <= 3.0%, Crypto <= 3.25x, desired Total <= 5.0x, 12.5% available-balance reserve.
- PROFIT_2: TWR >= 1.10 and DD <= 2.0%, Crypto <= 3.50x, desired Total <= 6.0x, 10% reserve.
- PROFIT_3: TWR >= 1.20 and DD <= 1.0%, Crypto <= 4.00x, desired Total <= 7.0x, 5% reserve.
- PROFIT_4: TWR >= 1.30 and DD <= 0.5%, Crypto hard ceiling 5.00x, desired Total hard ceiling 8.0x, 0% extra reserve.

At 5x Cross, the margin governor constrains realizable Total Gross below the 8.0x absolute ceiling when available balance is insufficient.

## Formal backtest evidence

Period: 2025-08-10 through 2026-08-10.
Capital: JPY 10,000 initial + JPY 10,000 monthly x12, compounding.

Static 4.25x baseline, with DD entry scaling disabled:
- NORMAL: ending asset JPY 1,479,916,279.65; PF 4.18705843; max DD -19.61179353%; trades 1180; max Crypto 3.0x; max Total 4.25x; Gross conflicts 0.
- SEVERE: ending asset JPY 84,470,298.59; PF 3.07036; max DD -19.97886021%; trades 1031; max Crypto 3.0x; max Total 3.0x; Gross conflicts 0.
- Evidence: docs/research-results/final-static-4p25-baseline-20260922.json.

Final LIVE governor replay:
- NORMAL: ending asset JPY 1,448,665,533.02; PF 4.14112335; max DD -19.61179353%; trades 1164; max Crypto 4.67947803x; max Total 5.0x; max FET 2.25x; Gross conflicts 0.
- SEVERE: ending asset JPY 75,982,803.52; PF 3.01497717; max DD -19.97886021%; trades 1020; max Crypto 4.63551394x; max Total 4.63551394x; max FET 2.25x; Gross conflicts 0.
- Evidence: docs/research-results/final-live-governor-20260922.json.

The final LIVE governor is selected even though the static 4.25x replay has slightly higher ending assets because the LIVE governor explicitly bounds additional exposure by fresh profit, TWR/DD, and available-margin evidence while preserving the same sub-20% observed replay drawdown.

## Safety lineage retained

The final implementation must retain:
- pre-submit V12 gross reservation and worst-case exposure accounting;
- operator activation gate on every automated runner/recovery path;
- root-owned activation artifact validation;
- state ownership and atomic recovery hardening;
- Shared Risk and Margin Guard fail-closed behavior;
- protective-order readback and reconciliation before activation;
- no automated restart into real-money trading without matching approved runtime SHA.
