# DisDex Multi-SHA Production Safety and Evidence Design

Date: 2026-10-29 (JST)

Status: Proposed — implementation is not authorized until this design is approved.

Working base: `06555dcaaf8b62fd8f8fcec2b6fa650225012f2c`

Working branch: `codex/disdex-production-safety-20261029`

## Context

The production estate is intentionally running multiple runner lineages. The
latest merged source contains the runner tick-heartbeat contract and the
cross-SHA STOP/risk evidence work, but the current root wiring and preflight
still contain assumptions that all peers share one deployed SHA. The repository
also contains open research drafts whose economic behavior must not be promoted
to LIVE without separate native-history and economic certification.

The current source-level pins that must remain distinguishable during the
migration are:

| Runner or component | Current evidence pin | Required treatment |
| --- | --- | --- |
| V4 | `53a0be396719f0284af4e11b35c66a4ac7d58f79` | Independent V4 primary owner and service |
| Q102 | `ef1ab178e26a7bf5bddb6473467765edba242e1d` | Independent Q102 owner and service |
| V52 | `97830672e2f139b39f7194166d7dc8c36e8c8933` | Independent V52 owner and margin path |
| Legacy shared peers | `7688ed7c93a1918d8b44837339b7da5584a868f5` | Preserve only as an explicitly pinned legacy lineage |
| Candidate release | `06555dcaaf8b62fd8f8fcec2b6fa650225012f2c` | Candidate source; never implicitly LIVE |

The exact production values must be replaced by read-only VPS evidence before
they are described as current production values. No historical report, local
worktree, or PR body is a substitute for a signed venue readback or an actual
systemd/runtime inspection.

## Goals

1. Represent every runner, support service, health monitor, watchdog, STOP
   owner, and Shared Risk Writer by its own exact SHA, service unit, release
   root, and evidence mode.
2. Preserve the old LIVE runner and its existing position/STOP state until the
   replacement has passed the formal gates.
3. Make tick evidence truthful: a marker is written only after a real decision
   cycle completes, and a legacy binary is monitored through its existing safe
   path instead of being forced into the new marker contract.
4. Eliminate same-process/same-millisecond temporary-file collisions without
   weakening validation, freshness, account locking, rate budgets, or fail
   closed behavior.
5. Keep V4 and Q102 STOP ownership independent, preserve the 7.5% Shared Risk
   daily loss limit, and treat unknown, partial, stale, or unreconciled STOPs
   as unsafe.
6. Keep #296 economic changes and #261 V52 stale-quote behavior out of the
   LIVE candidate unless their independent gates are later satisfied.
7. Produce auditable source, test, release, operator, and deployment evidence
   without fabricating approval, native history, venue state, or heartbeat
   markers.

## Non-goals and hard prohibitions

- No Vercel deployment or Vercel runtime configuration.
- No unauthenticated test order, real-money test order, forced close, STOP
  cancellation, STOP quantity change, or Kill Switch relaxation.
- No dynamic Gross allocation. Existing Gross caps and the rule “transfer only
  when available Gross is insufficient” remain unchanged.
- No automatic promotion of HYPE M5, AVAX, or other #296 economic behavior.
- No use of Binance or another venue as a substitute for missing Aster native
  history in formal certification.
- No copying, editing, date-changing, ACK-forging, or SHA-rewriting of an
  operator artifact.
- No direct edits to the dirty original checkout or to an existing PR worktree.
- No LIVE claim until signed venue evidence, root-owned operator approval,
  immutable release evidence, and the required post-cutover audits exist.

## Proposed architecture

### 1. Canonical runner pin manifest

Introduce a root-managed, immutable runner-pin projection consumed by the root
wiring, health snapshot, watchdog, preflight, and STOP-owner checks. The
projection will contain one record per logical runner and support service:

```json
{
  "schema": "disdex-runner-pin-manifest/v1",
  "target": "professional-dismanager.net",
  "runners": {
    "V12_V4": {
      "sha": "<40-hex>",
      "releaseRoot": "/var/lib/disdex/trading/releases/<sha>",
      "serviceUnit": "disdex-v12-v4@<sha>.service",
      "evidenceMode": "tick-v1",
      "stopOwner": "V4_PRIMARY"
    },
    "QUALITY102_CAUSAL_V1": {
      "sha": "<40-hex>",
      "releaseRoot": "/var/lib/disdex/trading/releases/<sha>",
      "serviceUnit": "disdex-quality102-causal-v1@<sha>.service",
      "evidenceMode": "legacy-or-tick-v1",
      "stopOwner": "Q102_PRIMARY"
    }
  }
}
```

The actual implementation may use the existing root-owned environment
projection instead of this exact JSON shape, but it must provide the same
one-to-one fields. The source of truth must be validated as a regular,
non-symlinked, root-owned, non-world-writable file. Every SHA must be a full
40-hex value; every release directory must contain the same release marker; and
every service unit must end in the exact corresponding `@<sha>.service`.

For the migration period, the manifest explicitly records whether a binary
emits the tick-v1 marker. A legacy binary is not declared tick-healthy merely
because a monitor can read a marker path. The monitor keeps its existing safe
heartbeat/state contract for that runner until a release containing the writer
is actually deployed and proven.

The current `DEPLOYED_SHA` fallback must not silently populate all peer records
in multi-SHA mode. A fallback is permitted only for an explicitly declared
single-lineage legacy mode and must be visible in the plan output.

### 2. SHA-bound wiring and monitoring

Refactor `scripts/ops/root/disdex-current-runtime-wiring` so that unit names,
release roots, operator-gate arguments, health snapshot environment, watchdog
environment, alert environment, margin guard, and Shared Risk Writer are
derived from the validated per-runner records.

The V4 primary remains a separate V4 release and service. V4 must not cause a
peer runner to inherit the V4 release, and a peer runner must not cause the V4
health snapshot to inherit the generic current release.

The health snapshot will expose both:

- `heartbeatAt`: the time the supervisor or monitor produced its observation;
- `lastTickAt`: the time the runner completed its actual decision cycle.

`lastTickAt` is accepted only from a validated marker or the explicitly
declared legacy evidence mode. Marker identity, SHA, service unit, release
root, age, future timestamp, status, reason, and counter fields remain
fail-closed.

### 3. Tick storage and truthful tick publication

Integrate the source and contract behavior from #300 only after verifying it
against the base SHA:

- create `/var/lib/disdex/runner-health/ticks` under a root-owned parent;
- refuse symlink/file substitutions for the parent or child;
- give only the required deploy service account write access to the child;
- add narrowly scoped `ReadWritePaths` drop-ins to tick-capable units;
- validate `ProtectSystem` and drop-in ordering before daemon reload;
- never create a marker from an operator script, migration script, or test
  command pretending to be a runner cycle.

The TypeScript tick writer and all shared state writers covered by the
collision tests will use a per-publication UUID plus exclusive creation for
the temporary inode, preserve atomic rename, and clean up on failure. The
writer will not change the decision result or order behavior.

The migration tests will cover V4, Q102, PENGU, V52, FET, HYPE, and IDLE in
both supported evidence modes. Statuses such as no-signal, lock, held, and
market-closed are recorded as real decision results; they are not converted to
synthetic “healthy trading” signals.

### 4. Shared Risk and STOP ownership

Keep the independent V4 and Q102 STOP proof paths. The owner map will be
runner-specific and will never classify an unknown STOP as managed merely
because the symbol or side looks familiar.

The source contract remains:

- exact owner SHA and service identity;
- exact STOP quantity for the protected leg, including V4 partial-quantity
  ownership;
- fresh evidence and UTC-date-consistent Shared Risk snapshot;
- inherited latch and 7.5% daily loss limit;
- fail closed for unknown, partial, stale, or failed-recovery protection;
- no simultaneous old/new Risk Writer activation.

During a writer transition, existing peers, positions, and STOPs remain on
their current SHA until the new writer has independently proved that it can
read and preserve them. No transition step sends an exchange mutation.

### 5. Operator activation and preflight

Extend the existing operator gate rather than bypassing it. The gate will
accept per-runner SHA evaluation while preserving the required fields:

- `approvedSha` or an exact runner-keyed SHA map;
- `target`;
- `approvedRunners`;
- root ownership and non-root write protection;
- auditable approval time;
- release marker and runner scope;
- implementation readiness.

An old single-SHA artifact may be used only when the requested scope is truly
single-SHA. A multi-SHA `--all` activation must prove every runner’s exact
SHA; it must not treat the candidate common SHA as the identity of all peers.

The read-only preflight will accept an explicit before/after pin manifest and
will report runner-level blockers. It will continue to return
`liveOrderAuthorityGranted: false` and
`formalVenueOrderExecutionCertified: false` unless the formal external gates
are separately satisfied.

### 6. API budget, lock, and persistence hardening

Apply only the minimal safe portion of #260 to the current base:

- UUID-bearing temporary names for global rate budget writes;
- UUID-bearing exclusive temporary files for IDLE and HYPE state writes;
- preserve all existing state schema, freshness, recovery, and fail-closed
  checks;
- retain the existing UUID account lease, owner check, expiry, and release
  behavior;
- add injectable jitter to read-only retry backoff where the shared budget is
  not the controlling mechanism;
- never retry order mutations or HTTP 418;
- preserve cooldown and global budget saturation behavior;
- log budget owner, competing owner when observable, wait duration, cooldown,
  retry count, and defer/skip reason without writing secrets.

The concurrency suite will include at least 80 simultaneous writers, multiple
runner contention, same-PID/same-millisecond scheduling, stale lock recovery,
abnormal termination, restart recovery, malformed state, stale snapshot, 429,
418, cooldown, backlog saturation, and a check that retry activity does not
starve protective STOP observation.

### 7. Gross, reservation, and runner logic boundary

The implementation will first add contract and reconciliation tests around the
current approved behavior. Any change that changes entry timing, priority,
preemption, liquidation timing, HYPE/AVAX behavior, or expected PnL is a
research candidate and will not enter the LIVE release in this task.

The tests will assert:

- existing positions and STOPs are preserved when available Gross exists;
- preemption occurs only when Gross is actually unavailable and the new order
  can proceed after the reservation;
- stock Gross shortage is not repaired by closing crypto positions;
- NaN, Infinity, negative, missing, or stale notional is never a permission
  basis;
- timeout, UNKNOWN, restart, and partial-fill paths reconcile before any new
  permission;
- V4 internal 4.75x and common portfolio 4.25x caps remain distinct and the
  final permission uses the authoritative lower applicable cap.

### 8. HP and reporting

The HP-facing snapshot will consume the same runner pin and evidence map. It
will not infer current SHA from an old static page or anonymous HTTP 200.
The schema will expose runner identity, active/inactive state, reason,
heartbeat/tick timestamps, permission/hold/STOP state, Q102 family/layer/score,
V4 route count, ranking, Shared Risk, API backlog, Margin Guard, pending, and
asset-class Gross.

The source work will add contract tests for page-to-snapshot consistency and
will identify authenticated endpoint requirements. Actual authenticated VPS
screen/data verification remains blocked until the prescribed SSH access and
venue evidence are available.

### 9. Research and native-history boundary

The annual integrated BT is a separate evidence track. It may use only Aster
native data and must record the exact data date range, warmup, costs, Gross,
leverage, assumptions, and missing periods. If the required 181-day warmup is
not available for the eight affected symbols, the result remains
`BLOCKED_NATIVE_HISTORY` and is not used to authorize LIVE behavior.

Any available-period exploratory result will be stored under
`C:\Users\dis\Desktop\DisDex_AI_Files\01_BT_Research\YYYY-MM-DD_<strategy>_<experiment>`
with a manifest that clearly distinguishes research from LIVE.

## Rollout and safety sequence

1. Run source-level failing tests against the base SHA and record the current
   failures.
2. Implement and test the canonical pin/evidence model without enabling orders.
3. Implement collision-resistant persistence and retry tests.
4. Integrate and re-test the #300 storage contract.
5. Generate an immutable release candidate and SHA256 manifest.
6. Run read-only release/preflight checks for every runner and support service.
7. Obtain formal root-owned operator approval for the exact release and exact
   runner scope. If unavailable, stop with `BLOCKED_OPERATOR_AUTH`.
8. Obtain the prescribed SSH key and perform read-only VPS inspection. If
   unavailable, stop with `BLOCKED_VENUE_EVIDENCE`.
9. Obtain signed Aster readbacks for positions, STOP/TP, open orders, pending,
   balance, Gross, Margin Guard, Shared Risk, and Kill Switch. Any missing or
   changing evidence remains blocked.
10. If and only if all gates pass, perform the dependency-ordered cutover while
    preserving old positions and STOPs, then run three audit cycles.
11. On any post-cutover failure, stop new orders, preserve existing STOPs,
    reconcile state, and use only an approved safe rollback.

No step above grants order authority by itself.

## Verification matrix

| Area | Required evidence before claiming completion |
| --- | --- |
| Source | Focused tests, full relevant suite, and clean diff from `06555d…` |
| SHA wiring | Runner-level unit/release/marker/operator/monitor identity tests |
| Tick | Real writer tests, storage permission contract, stale/future/SHA/service/atomic failure tests |
| Risk/STOP | Independent V4/Q102 proofs, unknown/partial/freshness fail-closed tests |
| API | 80-way contention, lock recovery, rate budget/cooldown/backoff/jitter tests |
| Gross | Reservation and priority contract tests with no dynamic Gross |
| HP | Authenticated source contract and snapshot/page consistency evidence |
| Release | Immutable artifact, SHA256, release marker, CI status, operator scope |
| Venue | Signed read-only Aster GET and exact reconciliation of positions/orders/STOPs |
| LIVE | Root approval, VPS applied evidence, three audit cycles, zero unapproved mutations |

## Required outcome labels

The final report will use these labels exactly:

- `FIXED_AND_VERIFIED`
- `SOURCE_READY_NOT_LIVE`
- `BLOCKED_OPERATOR_AUTH`
- `BLOCKED_NATIVE_HISTORY`
- `BLOCKED_VENUE_EVIDENCE`
- `LIVE_VERIFIED`

No source or CI result will be reported as `LIVE_VERIFIED` without actual
production evidence.

