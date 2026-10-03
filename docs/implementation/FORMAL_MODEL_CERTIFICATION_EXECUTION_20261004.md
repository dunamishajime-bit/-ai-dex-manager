# Formal model certification / HYPE resilience plan

User approved on 2026-10-04: explicitly labeled conservative causal-model
evidence plus fresh LIVE safety checks, rather than invented historical
account/execution equivalence. Native inline execution, preserve all Safety
Gates and existing positions. No synthetic/test/manual probe orders.

## Contract

Preserve Formal V12 sizing, Q102 priority families, actual venue exit + 2h
symbol cooldown, retained Idle/Overlay signals and portfolio caps. H1 model
results are not exchange fills or L2 evidence. Historical evidence reports
remain unchanged. New model evidence has its own assumptions/source hashes.
Missing market input remains SOURCE_ERROR/no entry. No historical filters,
margin snapshots or executions may be fabricated.

## Task 1: HYPE resilience

- [x] RED then GREEN for flat pre-order budget LOCK_TIMEOUT/SATURATED HOLD.
- [x] Existing review, pending, active position, malformed/unknown error and
  any error after order mutation remain fail-closed. Fresh no-entry heartbeat.
- [ ] HYPE/rate tests, TypeScript, project suite; commit, Push, actual Linux CI.
- [ ] Existing stopped state needs separate reconciled recovery and exact backup;
  do not repurpose the market-row-only recovery helper.

## Task 2: Conservative model evidence

- [ ] Re-run five configurations x 8/10/20/30bps with post-fee headroom.
- [ ] Verify each entry's ownership, sleeve/total caps and modeled 5x reserve.
  Sleeve warnings must not be silently labeled certification PASS.
- [ ] Full decision coverage; source errors fail-closed; pending/filter/fill
  assumptions declared and separately tested against Production contracts.
- [ ] Independent equality, SHA256 ledger manifest and paired attribution.
- [ ] Include all enabled scope (including HYPE if enabled) before issuing a
  combined exact-runtime model certificate.

## Task 3: Integration and Production

- [ ] New certificate consumption enforces exact runtime/source contract,
  not relabeled old certificates. Test/typecheck/build/Push/actual CI success.
- [ ] Fresh Aster/safety/state/permissions/lock preflight; backup and formal
  HYPE/other state reconciliation. Existing protection preserved.
- [ ] Immutable release, atomic current, wiring, exact root operator artifact.
- [ ] Sequential activation, same SHA, old active=0, no restart loops.
- [ ] Multiple-cycle heartbeat/Safety/Aster/UI audit before success report.

Review focus: post-submit budget error; cross-strategy same-symbol ownership;
fee-induced equity shrinkage; residual held during source error; concurrent
branch and HP changes. Do not mutate Production until every gate passes.

## Verified progress before CI (2026-10-04)

Local HYPE/shared/Formal/operator tests: 138 discovered, 137 pass, one
Linux PID-reuse case skipped on Windows; systemd contract 1/1 pass.
TypeScript exit 0. Ownership 8/8 pass; Overlay discovery 23 test executions
pass (inherited cases included). Full Windows Python discovery had three
environment import errors (websocket/fcntl); actual unfiltered Linux discovery
with the pinned websocket dependency remains required.

The sleeve fee cap regression was observed RED and corrected; the no-partial
fixed-Idle regression was also RED then GREEN. The earlier 20-case run is
intermediate and invalidated by the subsequent fixed-Idle admission check.
See FORMAL_MODEL_SCOPE_GAPS_20261004.md for unresolved scope discrepancies.
These are not cleared by CI success and prohibit Production certification.

Read-only VPS recheck: current/marker 53eeff5417636369d4709fddfd47d7916ddcf3b1;
HYPE remains intentionally unmodified in manual review. Existing core, Idle
and safety services are running. No Production mutations were executed.
No independent reviewer tool is available; local boundary review added the
post-read-only budget-shaped exception case, but is not independent review.
