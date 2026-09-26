# V12 HP all-gate visibility, September 26, 2026

Branch: codex/v12-hp-all-gates-20260926, based on codex/hp-mobile-fet-detail-20260925.
The HP reads runner-authored independent allGateChecks from the V12 snapshot (the
separate research/v12-score-gap-multigate-20260926 branch provides their producer).
If the current production runner lacks that schema, the UI explicitly marks
"all gates unavailable" and still shows the original authoritative runner reason.
The UI never fabricates PASS for missing fields. NOT_EVALUATED is not PASS.

The latest bar view separately displays all failed gates, score gap counts,
strong-regime non-continuity and multiple simultaneous failures. Momentum fields
are runner fractions and are multiplied by 100 for percentage display.

For history, the UI reads the runner's existing UTC daily JSONL files for the
previous 7 days (bounded 2 MiB per day). It deduplicates selected Top3 signals
by timestamp/symbol/side and displays H2 repeated observations plus 24h/46h
spaced independent per-symbol episodes. Historical actual orderability and true
executions remain explicitly UNVERIFIED: these require original event ledger,
Aster entry order readback, shared gross and the five-logic risk overlay.
Daily files unreadable/absent never display fake zeros.

No backtest, strategy parameter, real order, production release, or runner
configuration is changed by this branch. Deploy only after confirming the real
currently deployed HP UI source SHA and completing typecheck/tests. The runtime
research producer also remains research-only until the formal integrated NORMAL
and SEVERE original five-logic engine has reproduced its baseline.
