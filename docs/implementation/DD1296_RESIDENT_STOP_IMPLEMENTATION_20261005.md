# DD12.96 resident protection implementation

Authorization: user's latest 33-section implementation/deployment specification. Source handoff db0ee5def97e8194f55aa77fa5b7326fa938d456; production baseline e9f69394dacbf9abac63829529462714e8316c56. No research checkout deployment.

1. Save actual VPS service/state/venue/lock baseline and exact modern UI source. Retain e9 immutable rollback. Full source/ledger validation.
2. Add deterministic durable resident stop lifecycle for ordinary PENGU and Q102. Use actual fills and existing stop fractions only. Normalize against venue filters, verify read-back, adopt on restart, fail closed on ambiguity. Do not cancel protection before replacements verified. Reconcile venue fills before strategy accounting, preserve exactly-once processing and pending state. Validate cross-runner ownership and Python validators.
3. Retain existing V12/Recovery/FET/HYPE/Idle/overlay strategy/stop behavior; test lifecycle/regressions. V52 dynamic Basis Stop 1.75 only; fixed entry-reference protection disabled.
4. Extend actual modern UI providers/components with sizing, gates, counters/cooldowns and venue protection status; preserve modern UI safety/auth/history fixes.
5. Run meaningful red/green lifecycle/integration tests, TypeScript/build, relevant selftests, full regression and formal anchor/parity checks. Fresh final branch review.
6. Push exact commit, confirm remote, stage immutable release, reconcile/migrate existing states without flattening, update exact activation, atomic current cutover, restart all affected/support services. Preserve current FET 515 LONG and verified profit-floor STOP.
7. Observe at least one decision cycle; reconcile actual venue orders/positions, all runtime SHA, locks, risk/guard/watchdog/history, UI fields. Save evidence and report full success only when all criteria verified.

Audit: /var/lib/disdex/deployment-backups/resident-stop-preaudit-20261005/{audit,venue}.json. At audit only FETUSDT LONG 515, avg 0.2407, reduce-only SELL STOP_MARKET 515 at 0.241900; order 568441254. No orders/cancels submitted by audit.

Historical limitations: research anchor reproduction is not a claim of replaying the entire live execution path. Stop execution timing must be compared explicitly; no unconditional assertion of equality from copying existing ledgers.
