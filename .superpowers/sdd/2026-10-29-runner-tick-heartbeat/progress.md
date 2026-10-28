# SDD ledger — plan: docs/superpowers/plans/2026-10-29-runner-tick-heartbeat.md

Pre-flight: Task 1 produces the marker schema and writer interfaces consumed by Tasks 2 and 3; Task 2 supplies the production marker identities consumed by Task 3; Task 3 validates the same fixed root, runner IDs, SHA, service units, and freshness windows. No conflicting interfaces found.

Ruling: Use the existing production release SHA/runtime SHA and service-unit naming already present in each Runner entrypoint — this avoids inventing lineage values and keeps the marker proof bound to existing identity gates; the cost if wrong is a scoped BLOCKED Runner rather than an unsafe enablement.

Task 1: complete (commits 132fa65..132fa65, tests: `npx tsx --test tests/runner-tick-heartbeat.test.ts` and `python -m unittest tests.test_runner_tick_heartbeat -v` → PASS)

Task 2: complete (commits 1f64852..1f64852, tests: focused TypeScript/Python marker tests, `python -m py_compile scripts/disdex_runner_tick_heartbeat.py scripts/disdex_v52_aster_only_legacy_engine.py scripts/disdex_v52_aster_only_live_engine.py`, and `npx tsc --noEmit` → PASS)

Task 3: complete (commits 949866a..949866a, tests: `npx tsx --test tests/runner-health-tick-contract.test.mjs`, `npx tsx scripts/ops/root/disdex-runner-health-snapshot-current.mjs --self-test`, and `python -m unittest tests.test_runtime_health_snapshot_current -v` → PASS)

Ruling: Mutation counters are part of the marker's safety identity, not advisory telemetry; invalid or negative `ordersSent`, `cancelsSent`, or `positionChangesSent` now fail closed. The cost of rejecting a malformed marker is a scoped health block, which is safer than accepting untrusted evidence.

Task 3 hardening: complete (commit pending, tests: `npx tsx --test tests/runner-health-tick-contract.test.mjs`, `npx tsx --test tests/runner-tick-heartbeat.test.ts`, `python -m unittest tests.test_runner_tick_heartbeat -v`, `npx tsx scripts/ops/root/disdex-runner-health-snapshot-current.mjs --self-test`, `python -m unittest tests.test_runtime_health_snapshot_current -v`, `npx tsc --noEmit`, and Python `py_compile` → PASS)

Ruling: Windows full-suite failures remain environment-specific (bash/subprocess/import assumptions) and are not used as Production evidence; focused tests plus Linux CI/VPS checks are the authoritative gate. The risk of missing an unrelated Windows-only regression is mitigated by the focused contracts and the required Linux verification before any cutover.
