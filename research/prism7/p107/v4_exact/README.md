# P107 native V4 as-of entry identity: exact pinned source 1,394 / 1,394

The frozen V4 source is Git commit e788abc82e80f9fc7ab0e1ba83fdb8be267eb513. We checked it out as a standalone git worktree on the owner PC without changing Production and used the original immutable functions loadV4ClosedCandles and buildV4LiveDecisionBatch.

The input is ASTER official 1H source JSONL gz for the 14 V12_X1_ALL symbols, with SHA256 for each original input in P107_V4_PIN_NATIVE_H1_1YEAR_DECISION_SCAN_20261123.json. At each 2-hour grid we fed only the last 500 closed 1H bars as an offline getKlines mock; no network calls, credentials or order executor.

Annual sample: 2025-10-01 to 2026-10-01 UTC exclusive, 4,380 grids. 41 fail-closed due to authentic BTC malformed OHLC 2025-09-13 13:00 UTC crossing the 500-bar input warmup. 4,339 native decision snapshots valid; **1,394 candidate signals**.

Compared every event to the independent native 2026-11-09 tape native-V4-raw-intentions.jsonl (old research source SHA 3ad654...): decision timestamp, symbol, side, route, rank, eligible entry timestamp match on **1,394 / 1,394**, zero unmatched events. The per-decision H1/H2 sourceFingerprint matches **1,394 / 1,394**. Source SHA differs between tapes, but the specific entry decision source output and input fingerprint are identical on every raw candidate. This is a certified **raw entry identity subgate**, NOT a V4 final-trade model or account-wide STABLE4 result.

The pinned code exports V12_V4_MAXIMUM_DRAWDOWN=0.21 as a risk rule. Actual DD HOLD, margin/position competition, shared risk, exit / STOP / TP / partial and funding were **not** applied to these 1,394 source candidates. The decision builder itself returns orderEnabled=false, realOrderEnabledV4=0 and tradingMutation=0.

Repro on owner PC: place p107_v4_current_pin_native_h1_scan.ts alongside a standalone V4 checkout at exact SHA e788abc8..., then execute tsx with the checkout tsconfig path, pointing at the local ASTER BT root and a new isolated output JSON. p107_compare_v4_1394_pin_old_ledger.py regenerates the identity comparison given raw old tape. No production actions.
## 2026-11-23 1394 / 1394 model exit rule and ATR verification

Pinned V4 SHA e788abc82e80f9fc7ab0e1ba83fdb8be267eb513. The old 1394 modeled exits were generated from older SHA 3ad654... and audited against immutable current pinned source from ASTER historical H1/M5.

- Independently recomputed native production H1 entry ATR for every 1394 candidate: 1394 / 1394 identical, maximum absolute difference zero.
- FOUR_RULE_M5 early adverse candidate source function: 131 / 131 exactly matching event time, reason and market reference price.
- FOUR_RULE_H1 profit protection combined with chronological M5 state: 176 / 176 exactly matching event time, reason and reference price; zero conflicting earlier M5 exits.
- Actual current pinned evaluateProductionExit / evaluateNativeProductionExit for the remaining TIME, ATR and NATIVE exits: 1087 / 1087 exactly matching event time, reason and reference price.
- Summed 307+1087 = 1394 all conditional model exits identical. No source exception or gap. We preserve the complete unmodified ASTER historical input windows, source file SHA256 and a zipped input bundle.

Strict distinction: the FOUR_RULE_M5 outcome is named V4_SHORT_INITIAL_ADVERSE_CANDIDATE in code. It is a prospective exit signal, not a signed ASTER fill. The old trade book models it as an execution. None of the 1394 entries or exits has verified actual venue fill proof as part of this study. It is source-model parity CONDITIONAL on hypothetical isolated fills and ATR, not chronological portfolio order/fill/DD21 HOLD/Shared Risk/Gross parity. Do not treat 1394 as a permitted LIVE trade count. Account NAV/DD and order-readmission must be rerun from source-native events and signed broker geometry and complete market data before P107 PASS.

Research only; no production mutations, no order/STOP/Kill Switch action.

## 2026-11-23 V4 shared reservation DD21 cumulative-latch source test

The exact native pinned createProductionState and applyProductionEvent journal set maxDrawdown to the maximum of prior drawdown and 1 - equity / equityPeak. V4SharedReservations.reserveUnderLease rejects if maxDrawdown > V12_V4_MAXIMUM_DRAWDOWN + 1e-12 (21%). Five static cases passed: 20%, exactly 21%, just over 21%, 22% then full NAV recovery, and a new equity peak followed by a 22% drawdown.

A later NAV recovery alone does not reset cumulative maxDD; a V4 shared reservation remains blocked after DD exceeding 21%. This is the pinned runtime source rule; any operational rearm requires an independently authorized and verified mechanism, not a BT-invented automatic unblocking.

This tests source-latched DD state only. It does not model chronological account NAV, shared daily-loss kill switch, portfolio opportunity allocation or signed exchange orders. No live settings were changed.
