# Pending reconciliation continuity — implementation plan

Owner authorized autonomous Codex root SSH repair/deployment; no subagents and
no repeated plan approval. This is noneconomic safety maintenance. It cannot
enable orders, release reservations, close positions, cancel STOPs or alter Kill.

Observed cause: pending.updatedAt only advances during reservations/manual
reconciliation. A quiet account becomes stale despite a healthy Risk Writer.
The shared TypeScript registry limit is five minutes, so a five-minute timer
with jitter would itself create stale gaps. The existing 5304 one-shot helper
is genuine signed GET under the account lock, but requires an actual SSH parent.
Copying SSH variables into a scheduled job would misrepresent its authority.

Ruling: use a separate root-committed no-order maintenance authority, with a
short one-use token consumed at installation. The immutable committed deployment
receipt authorizes only the same service/source/scope thereafter. This is not a
fresh owner signature or a re-dated old activation. Root parent issues a new
60-second, PID/hash/source-bound child grant per run. Child runs as deploy and
can change only pending.updatedAt after fresh signed read-only reconciliation.

Implementation order:

1. Extract/reuse the existing GET-only SDK transport and strict registry/file
   metadata validators. Preserve manual v1 grants; introduce an explicit service
   v2 grant with ROOT_COMMITTED_NO_ORDER_MAINTENANCE authority, never fake SSH.
2. TDD exact source/target/scope/expiry/parent PID/registry hash and schema checks,
   rejection of unauthenticated apply, replay, forbidden mutation and bad data.
3. Require account lock around fresh signed reads, final registry/hash and grant
   revalidation, atomic exclusive UUID write, fsync/readback and owner/mode
   preservation. Never restore an old registry after releasing the lock.
4. Flat account is valid only with zero open orders and all entries RELEASED.
   Nonflat requires independent owner/quantity/protective STOP proofs. Unknown
   orders, active/UNKNOWN reservation, partial STOP, missing/stale proof or
   mismatch leaves registry unchanged. Stock ownership must not be inferred
   merely from a stock-like symbol. Explicitly report unsupported evidence.
5. Add exact no-runner-delta PENDING_RECONCILE_ONLY plan/contract and root service
   installation/rollback. Keep all Runner pins/units/order authority unchanged.
   Service authorization must verify root-owned COMMITTED receipt, immutable
   marker/source, consumed nonce and current-plan/runner-manifest consistency.
6. Timer cadence: OnUnitInactiveSec=90s, <=10s jitter, bounded 55s work. Normal
   success remains comfortably within five-minute freshness. Shared budget and
   STOP priority stay enabled; zero rapid HTTP retries. Busy/deferred outcomes
   record owner/wait/reason without fabricating a successful reconciliation.
7. Linux unit/integration/crash/80-concurrency and fake-signature/scope/replay
   rejection fixtures; CI; immutable SDK release; VPS read-only preflight.
8. Only then formally install the no-order service via authorized root route;
   observe three genuine scheduled signed reconciliations. Compare all peers,
   STOP/positions, Kill, Risk 7.5%, Gross, pending entry bytes and reservations.

Current checkpoint: plan only; no new maintenance grant/service/approval issued,
no timer installed. Base is 2737 (the deployed c9-derived strict Risk source).
Shared Risk is already verified separately and must not be disturbed.

Remaining all-runner milestones are still V4 exact-source/no-order recovery and
certificate/state handover, V52 formal root adapter and real strategy ticks,
per-runner STOP/API/admission audit, explicit final order/Kill gate, and
authenticated HP plus three-cycle final audit. No all-runner LIVE claim yet.
