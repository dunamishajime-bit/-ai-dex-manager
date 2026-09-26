# 復元済み旧統合BT + 原本ネイティブ新PENGU 比較（2026-09-26）

STATUS: PASS_RESTORED_OLD_ENGINE_BASELINE_PARITY / CURRENT_VPS_FULL_PARITY_NOT_VERIFIED

2025-08-10〜2026-08-10 / 初期1万円 + 毎月1万円×12 / 総拠出13万円 / 複利。

## Original provenance

- **Integrated execution engine**: recovered *unchanged* 2026-09-24 `integrated-engine.py` archived captured source, SHA256 `cae9785492ea5dda8173853fe2cbc7d99ea451f550a739fb7f014f4773d9899d`, run [35934170491](https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/35934170491).
- **Historical V12 ledger**: 2026-09-18 original Top2 (NORMAL 874, SEVERE 871), SHA256 `1f2c05f2a33e4ab4300eb3f6b39a36e0f853b32ddafdaeab1cda6ff016304125`. Original PENGU (66/66) SHA256 `d448c01d270c6ab7ed624719d188e176e0a5c4cd04e510eb96226fa5960574f8`. Original source artifact run [35337138289](https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/35337138289).
- **Historical Q102**: source-embedded 102 frozen candidates recovered; SHA256 `b45f492a67307cf1845fcce6af0919c5202a5853b13e7f0914daf11889bd5ead`.
- **Historical V52**: *original archived V52 source* checked out at pinned research SHAs. Original Yahoo Finance 60m cash and Aster 30m perpetual/funding data fetched anew. 57 V11 candidates, 165 V50 candidates, 246 session days. The frozen previous research had 74/208 raw candidates, therefore strict anchor amount reproduction **fails**. Original engine retained and both modes reran successfully in [36215106356](https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36215106356).
- **Native current PENGU**: original 2026-09-24 `scripts/research_pengu_flat1_dd_q60_robustness_20260924.ts` source from commit `daf9db5251d364951c158fc6b4a7abf53c2a593c`, unchanged strategy evaluation, merely added file export. Native Aster H1/funding re-fetched in [36215236060](https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36215236060). `COMBINED_FILTERED`, cap/every entry gross1, route Hard Stop quarantine60h, realized strategy DD17→pause72h; NORMAL69, SEVERE68 accepted standalone.
- **Comparison proof**: original engine baseline replay exactly matches archived-source/new-stock stage1 to JPY 0.00 in NORMAL and SEVERE, no cross-sleeve gross conflicts. Then replace only PENGU native entry/exit events under same archived shared risk and chronological capital ledger; finally separate gross-only sensitivity. Successful [36215606702](https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36215606702), artifact `restored-old-engine-vs-new-pengu-native-and-gross-sensitivity-20260926` (ID 10897092613).

| Case | NORMAL asset | PF | Max DD | SEVERE asset | PF | Max DD |
|---|---:|---:|---:|---:|---:|---:|
| Old native PENGU cap0.85 and frozen old engine | ¥165,415,077 | 4.104 | -12.84% | ¥22,177,854 | 2.929 | -26.05% |
| NEW native PENGU cap1.0 Q60 DD17/H72, **other variables frozen** | **¥318,749,762** | 4.079 | **-15.67%** | **¥33,887,246** | 2.868 | **-33.10%** |
| New PENGU and changed gross caps ONLY, **NOT LIVE PARITY** | ¥448,952,372 | 4.008 | -13.00% | ¥29,637,859 | 2.799 | -32.71% |

Old→new PENGU improves NORMAL asset approximately +92.70% and SEVERE asset +52.80%, but worsens portfolio drawdown in both stress definitions; SEVERE DD above -30%. Research, **not deployment approval**.

## Critical remaining gap: Full CURRENT VPS native-five-strategy backtest

The gross sensitivity is not a current implemented trading logic backtest. It reuses original **Top2** V12 signals; simply raising V12 maximumPositions to3 does not generate current Rank3 signals. It also uses frozen historic Q102 candidates rather than native Causal V4, includes no current FET BRK48 2.25 and protection/preemption, no current actual 1.75 HC entry/exit path, and no integrated DD/profit/margin governor that dynamically admits up to Crypto5.0/Total8.0. Actual authenticated Aster quote, order-fill and 5x Cross margin constraints are not reproducible from H1 candles without modeling.

**Never advertise the ¥448,952,372 sensitivity as production-LIVE equivalent**, or force its final amount to match old ¥1.449b results. Next full-parity experiment must generate *native-source actual current* V12, FET, Q102, V52 states from original VPS source SHA, then event-time integrate through this recovered, checksum-frozen engine, preserving current PENGU ledger.

No LIVE, VPS, order or protection change occurred. Only research branch `research/recover-final-governor-bt-20260926` modified.
