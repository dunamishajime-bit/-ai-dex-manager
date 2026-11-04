# Legacy peer actual decision ticks

Execute inline, without subagents, under the existing owner-approved migration.
No Production service/pin/permission changes are authorized by a source commit.

- [x] Add failing behavioral tests for an awaited real cycle, exception without
  marker, delayed persistence, exact service identity, held/locked/no-signal and
  unknown mutation counts. Use temporary directories, no venue adapter.
- [x] Reuse the reviewed 2a6f27c6 tick writer without modifying its contract.
  Add a small completion wrapper: validate LIVE identity before operation,
  await the operation, capture actual completion and publish, retain unknown
  counters. SHADOW/PAPER behavior and strategy scheduling remain unchanged.
- [x] Wrap the existing PENGU/HYPE/FET calls. IDLE records only after its entire
  unchanged SHORT/residual decision sequence. Q102 gets its own ef1 branch.
- [x] Prove exceptions and failed atomic writes never replace an existing tick;
  an unrecorded completed cycle fails closed rather than reporting a fake tick.
- [ ] Run existing atomic/state/runner tests, CI and source review. Publication
  failure emits no invented counter evidence; venue STOPs remain untouched.
- [ ] Before any future cutover, certify new per-runner SHA, actual service
  writable paths, activation, state lineage and real ticks together. Keep current
  legacy monitoring until that transaction succeeds. No monitor-only migration.

Checkpoint: six completion behavior tests and four-entrypoint wiring test passed;
combined Linux suite 65/65, no skips; five changed/new modules transpile without
syntax diagnostics. Source remains not LIVE. Unknown order/cancel/change counts
are omitted. Legacy result types do not attest admission: marker permission is
conservative false, never an invented order grant; actual root activation remains
authoritative. A marker publication error propagates fail closed and cannot be
mistaken for a successfully recorded tick. Q102 requires its own ef1 branch.
