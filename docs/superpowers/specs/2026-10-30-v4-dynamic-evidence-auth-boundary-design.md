# V4 dynamic evidence refresh and authorization boundary

## Context

PR #303 adds a useful separation between immutable release evidence and mutable
account/risk evidence, and keeps a stale-evidence V4 daemon alive with new
orders blocked.  It does not, by itself, connect the refresh worker to a
production scheduler or make its `--apply` command an owner-authorized
operation.  The work below is source-only and is based on the PR #302
deployment contract.

## Decisions

1. Reuse the three V4 commits from PR #303, but do not merge PR #303 as a
   whole.  PR #303 is based on the PR #301 merge and removes the PR #302 root
   gate, forced-command adapter, and deployment workflows.  Those deletions
   are outside this change.
2. Keep the 24-hour expiry for dynamic account/risk records.  The static
   route/source and execution-test records remain SHA-bound release proofs.
3. Add a separate `V4_EVIDENCE_REFRESH_ONLY` operator scope.  It is not a
   deployment scope, cannot change systemd, cannot change the current symlink,
   cannot alter runner pins, and always has `ordersEnabled=false`.
4. The refresh worker has two explicit modes: `--verify-only` and `--apply`.
   Exactly one is required; unknown or duplicate mode arguments fail closed.
   `--verify-only` never writes evidence.  `--apply` requires root, a
   root-owned activation lease that is bound to the exact SHA and refresh
   scope, and a root-owned immutable release marker.  It never accepts a
   password or a private key and it never produces order authority.
5. The activation lease is created only by the existing owner-signed
   deployment approval path.  A scheduled refresh can consume the already
   installed, short-lived, root-owned lease only for the no-order refresh
   scope; the ordinary deployment executor continues to require its own
   single-use owner nonce.  A lease cannot be widened to a runner deployment,
   LIVE order permission, rollback, or a different SHA.
6. A systemd timer invokes the refresh worker with `--apply` only after the
   root gate has installed the refresh lease.  A separate monitor timer remains
   read-only and cannot be treated as a refresh path.  A failed refresh leaves
   the existing evidence untouched and the V4 order gate blocked.
7. API budget handling stays fail-closed.  Refresh uses one bounded ordered
   signed read-only round and does not retry or bypass the shared budget.  The
   budget module records owner/contender, priority, wait, defer/cooldown and
   skip reason.  Tests prove bounded concurrency and that a refresh cannot
   create venue mutations.

## Safety invariants

- No production command, test order, cancellation, STOP change, position
  change, Kill Switch change, or current symlink change is part of this work.
- A stale or missing activation lease fails closed; stale evidence is never
  retimestamped, copied, or synthesized.
- Dynamic evidence is staged with exclusive temporary names and a single
  generation marker.  Mixed generations remain invalid after interruption.
- Existing runner SHA pins, service units, STOP ownership and orders-enabled
  state are read-only inputs to the refresh path.
- The only acceptable end states for a refresh are a fresh, read-only evidence
  bundle or an unchanged old bundle with V4 new-order permission blocked.
