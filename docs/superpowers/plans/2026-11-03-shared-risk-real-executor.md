# Shared Risk root execution implementation plan

The owner authorized the Codex root SSH route and asked to proceed without
repeated plan approval. No subagents. Installed root gate is byte-identical to
3524e3676848b9260f53164e07257acdda7bcc5c (SHA-256
54d83e8ccbe9ac5ce835d78650911537531ae9dd447347987b8dc0f3639ddf27).

Goal: make the existing no-order Shared Risk transaction usable with actual
multi-SHA Production, independent of V4 order permission, with real audits.

Constraints: exact SHA/target/plan, root SSH or owner token, one-use nonce,
ordersEnabled=false, no current-symlink change, no other-runner restart, no
exchange mutation or Kill change. Keep daily loss limit 7.5%, source freshness,
same-day latches, STOP ownership and pending. A flat-only witness must explicitly
reject non-flat venue; it cannot infer STOP owners. Preserve legacy peer source
and permissions; introducing one writer must not require converting every peer.

- [x] Identify why existing executor is not operational: requires V4 live ticks;
  default post-audit reads one static file; all legacy peer releases are subjected
  to new root-owned release convention; scoped root-SSH activation issuance and
  writer-specific prestart must be connected to the real transaction.
- [x] Add failing tests for authentic advancing Risk cycles, freshness, UTC day,
  7.5% limit, preserved latch/Kill/pending and unchanged peer PID/SHA.
- [ ] Implement a flat-only signed GET collector using the reviewed GET-only
  helper as deploy through the shared budget and account lock. Do not claim
  V4 tick success when V4 is failed/PID 0.
- [ ] Add real signed before/after proof production to the default executor and
  wait for three distinct actual Risk snapshot completions, not three timestamps.
- [ ] Scope old-runner baseline validation separately from new immutable writer.
- [ ] Issue legitimate exact-scope root-SSH activation after real preconditions,
  consume its nonce, wire a no-order prestart gate/unit and verified rollback.
- [ ] Test on Linux isolated fixtures; push source/CI; provision exact root helper
  and writer release; run non-mutating VPS preflight.
- [ ] Only then stop/mask old Writer, start one new Writer, verify inherited
  Risk/latches/STOP/pending/Kill and three real refreshes. Roll back on failure.

This branch starts at the installed helper's source solely to review its delta.
Do not merge the divergent old branch wholesale into master. V4 candidate and
other runner source stay in their independent worktrees.

Current implementation checkpoint: ten invariant/reader tests pass locally. The
reader is not connected to the production default executor yet; no root helper,
activation, writer, pin or exchange state was changed by this branch.
