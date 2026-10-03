# PENGU1.0 + HYPE latest-BT replay contract

User request: add PENGU all-entry Gross1.0 and HYPE to the latest ownership-corrected Core/Idle/DOGE/AVAX BT.
Base SHA: 123df49950e3d5aba61e2d50e9ee1a37fae620d7.
Original immutable archive: bt-v12-score100-volume080-normalonly-20260928.tar.gz, SHA256 891c36d8a5957cafe3aae65656a98b7c02a3c437c4f520fe63756d550f08b4fb.

Same dates, monthly contributions, compounding, V12/Q102/FET/V52 signals, ownership gate and allocator.
PENGU: preserve frozen route/lifecycle candidates; request exactly Gross1.0 at admission, retain cap1.0/no shrinking and portfolio Q60/DD17/H72 governors. This is a sizing comparison of the latest archived BT, not a freshly generated all-hour COMBINED_FILTERED signal replay.
HYPE: HYPEUSDT H1 Trend function from the pinned source; 360-H1 runtime window, EMA12/48/240, slope25bps, breakout24h30bps, EMA48 distance<=900bps, ATR14. Risk5%, Gross cap1.5, source buffer30bps. Fixed stop2.5ATR / fixed TP3ATR / hold168h as ACTUALLY used by the source runner; not an invented moving trailing stop. STOP-first H1 ambiguity except known open gaps. One slot, no entry shrinking, lowest priority; max50% reduction per Core capacity request from the source preemption planner. Existing HYPE blocks new Idle/residual admission as out-of-baseline sidecar exposure.

Tests: original5-case10bps equality; requested PENGU1.0; HYPE slot/cap/no-shrink; partial capacity/accounting; gaps and ambiguous stop/TP; all-scenario accounting and ownership. Keep all model limitations in the final report.
Results: five configurations x four costs (8/10/20/30bps); isolate PENGU-only and HYPE-only at10bps. Preserve trade, candidate-decision, event, funding, fee, monthly and source ledgers.
Production and operator artifacts are outside this BT request.
