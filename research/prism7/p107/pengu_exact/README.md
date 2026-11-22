# P107 PENGU pinned-source 116 -> 117 raw candidate correction

The exact pinned source is 1657e173d250ad58f53e62f7bb0a3428fb405496, native TypeScript function buildPenguDualLsV2Signal with recoveryV8Enabled and v64DynamicLongEnabled. All 1-hour ASTER inputs are fully causal, source SHA256 from original early and current archives in the JSON evidence.

Legacy pinned-pengu-entry-20261108.mjs only read the historical H1 beginning 2025-09-24. We reproduced **116 identical event keys** using that truncated warmup, exactly matching its old tape (25 LONG_V64, 40 SHORT_V20, 51 RECOVERY_V8).

Full source data going back to 2025-07-18 yields 117 raw candidates (25 LONG_V64, **41 SHORT_V20**, 51 RECOVERY_V8). Source-native buildPenguDualLsV2Signal was evaluated at EVERY hour of the one-year interval (8759 checks) using either 1000 or 999 contiguous fully CLOSED ASTER H1 bars at each timestamp: 117 / 117 identical event keys, source exceptions zero. The old tape misses one SHORT_V20 at 2025-10-10 06:00 UTC with next ASTER H1 entry open 0.0301 USDT.

The new 117-entry JSONL is a non-destructive copy of the 116 historical raw candidate records plus exactly one separately verified native asof candidate, labelled **RESEARCH ONLY**, not a backtest order or signed fill. It does NOT alter the old input files or Production. Any remaining difference in asof features is documented, not assumed zero by comparing event keys. Entry contract and current engine must be verified before using this candidate to perform accounting.

Tested lookbacks are fully closed 999/1000 hourly candles, NOT a proof of exactly what ASTER realtime endpoint returned at each historical timestamp. This is source-level entry evidence. No portfolio admissibility, STOP, funding, actual signed fills, Shared Risk or DD replay. P107 remains BLOCKED for full STABLE4.
