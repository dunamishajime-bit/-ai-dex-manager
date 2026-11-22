# P107 native V4 as-of entry identity: exact pinned source 1,394 / 1,394

The frozen V4 source is Git commit e788abc82e80f9fc7ab0e1ba83fdb8be267eb513. We checked it out as a standalone git worktree on the owner PC without changing Production and used the original immutable functions loadV4ClosedCandles and buildV4LiveDecisionBatch.

The input is ASTER official 1H source JSONL gz for the 14 V12_X1_ALL symbols, with SHA256 for each original input in P107_V4_PIN_NATIVE_H1_1YEAR_DECISION_SCAN_20261123.json. At each 2-hour grid we fed only the last 500 closed 1H bars as an offline getKlines mock; no network calls, credentials or order executor.

Annual sample: 2025-10-01 to 2026-10-01 UTC exclusive, 4,380 grids. 41 fail-closed due to authentic BTC malformed OHLC 2025-09-13 13:00 UTC crossing the 500-bar input warmup. 4,339 native decision snapshots valid; **1,394 candidate signals**.

Compared every event to the independent native 2026-11-09 tape native-V4-raw-intentions.jsonl (old research source SHA 3ad654...): decision timestamp, symbol, side, route, rank, eligible entry timestamp match on **1,394 / 1,394**, zero unmatched events. The per-decision H1/H2 sourceFingerprint matches **1,394 / 1,394**. Source SHA differs between tapes, but the specific entry decision source output and input fingerprint are identical on every raw candidate. This is a certified **raw entry identity subgate**, NOT a V4 final-trade model or account-wide STABLE4 result.

The pinned code exports V12_V4_MAXIMUM_DRAWDOWN=0.21 as a risk rule. Actual DD HOLD, margin/position competition, shared risk, exit / STOP / TP / partial and funding were **not** applied to these 1,394 source candidates. The decision builder itself returns orderEnabled=false, realOrderEnabledV4=0 and tradingMutation=0.

Repro on owner PC: place p107_v4_current_pin_native_h1_scan.ts alongside a standalone V4 checkout at exact SHA e788abc8..., then execute tsx with the checkout tsconfig path, pointing at the local ASTER BT root and a new isolated output JSON. p107_compare_v4_1394_pin_old_ledger.py regenerates the identity comparison given raw old tape. No production actions.
