# Runner tick heartbeat truthfulness design

## Intent

Make the production health snapshot distinguish a supervisor heartbeat from
the last completed Runner tick. The current snapshot periodically refreshes
`heartbeatAt` for every Runner but derives `lastTickAt` from strategy state
files that are not written on every `held`, `locked`, or `no-change` cycle.
That makes a live-but-blocked Runner look healthy and makes a live Runner with
an unchanged strategy state look stale.

## Goals

- Record one atomic, read-only-monitoring tick marker for every production
  Runner after each completed decision cycle, including `no-signal`, `held`,
  and scoped `locked` outcomes.
- Keep `heartbeatAt` as the health-snapshot supervisor write time and expose
  the Runner marker as `lastTickAt`.
- Mark a Runner blocked only when its own tick marker is missing or outside its
  configured liveness window; do not infer a block from a normal no-signal or
  market-closed result.
- Preserve fail-closed behavior for missing, malformed, future-dated, or
  stale tick markers.
- Add deterministic tests for atomic marker shape, stale/missing markers,
  status separation, and no order/cancel/position mutation.

## Non-goals and safety boundaries

- No exchange API request, order, cancel, position change, STOP change, or
  Kill Switch operation is added.
- No signal, entry, exit, Gross, Daily Loss, Shared Risk, Margin Guard, or
  operator-activation policy is changed.
- No AVAX/HYPE economic behavior is promoted to LIVE by this change.
- Existing immutable releases and the current systemd services remain active
  until the new SHA passes CI, venue read-only reconciliation, and a fresh
  SHA-bound operator gate.

## Approaches considered

1. **Per-Runner atomic tick marker (selected).** Each Runner writes a small
   root-readable marker after its completed tick, and the health snapshot
   validates that marker. This is deterministic and does not depend on journal
   retention or log formatting.
2. **Journal-derived liveness.** The health snapshot parses the latest Runner
   log entry. This is fragile under rotation, format changes, and missing
   logs, so it is not suitable as the primary safety evidence.
3. **Shorter state-file age thresholds.** This would falsely block healthy
   `held`/`no-change` Runners whose strategy state is intentionally unchanged,
   so it is rejected.

## Implementation boundary

The marker path is a fixed file under
`/var/lib/disdex/runner-health/ticks/<runner>.json`. Runner processes write it
with a temporary file and rename; the health snapshot only reads it. The
marker contains the Runner ID, runtime SHA, service unit, tick start/end
timestamps, status, reason, and zero mutation counters. Existing strategy
state files remain unchanged except where a Runner already persists its own
state heartbeat.

Each Runner keeps its configured liveness window. Market-closed and ordinary
no-signal ticks remain live if their marker is fresh; missing or stale markers
produce a scoped `BLOCKED` state and deny that Runner's new orders.

## Verification

- Unit/contract tests cover every Runner marker writer and snapshot reader.
- TypeScript/Python checks and all relevant GitHub CI jobs must pass.
- Release marker and source SHA must match.
- Aster signed read-only reconciliation must still show the existing DOGE
  SHORT 226 and its exact reduce-only STOP, with zero order/cancel/position
  mutations.
- No Production systemd switch is allowed while any safety gate or fresh
  operator artifact is missing.
