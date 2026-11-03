# Shared Risk root execution implementation plan

The owner authorized the Codex root SSH route and asked to proceed without
repeated plan approval. No subagents. The initial installed root gate was byte-identical to
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
- [x] Implement a flat-only signed GET collector using the reviewed GET-only
  helper as deploy through the shared budget and account lock. Do not claim
  V4 tick success when V4 is failed/PID 0.
- [x] Add real signed before/after proof production to the default executor and
  wait for three distinct actual Risk snapshot completions, not three timestamps.
- [x] Scope old-runner baseline validation separately from new immutable writer.
- [x] Issue legitimate exact-scope root-SSH activation after real preconditions,
  consume its nonce, wire a no-order prestart gate/unit and verified rollback.
- [x] Test on Linux isolated fixtures; push source/CI; provision exact root helper
  and writer release; run non-mutating VPS preflight.
- [x] Only then stop/mask old Writer, start one new Writer, verify inherited
  Risk/latches/STOP/pending/Kill and three real refreshes. Roll back on failure.

This branch starts at the installed helper's source solely to review its delta.
Do not merge the divergent old branch wholesale into master. V4 candidate and
other runner source stay in their independent worktrees.

## Production checkpoint, 2026-11-03 JST

The scoped cutover completed. This is **Shared Risk only**, not all-runner LIVE.

- Writer source: `2737c30e1f6d014d24a2c6d025e7f91332bf7962`, PR #424.
  This inherits c9, adds strict financial-source validation and retains the fixed
  7.5% limit and same-day latch. CI 3/3 success; Linux 80-publication test passed.
- Root cutover component: `184529a09de8e1a7f507755def10772bb56a3af6`, PR #422.
  CI 5/5 success; actual VPS isolated fixtures 66/66 success.
- Plan SHA-256: `3fa734f2e5eda22045f8f2d44aeceb0d234a55110131fa5f15c3acabf90f6ebe`.
- Receipt: `/var/lib/disdex/unified-deploy/receipts/shared_crypto_risk_only-2737c30e1f6d014d24a2c6d025e7f91332bf7962-dc96d69b.json`.
  Transaction phase is COMMITTED, status SHARED_RISK_CUTOVER_VERIFIED.
- New Writer PID 2017780, NRestarts 0, exact CWD/marker/runtime env SHA verified.
  Old 7688 Writer has PID 0 and is masked. No current symlink change.
- Three distinct successfully published Risk snapshot updatedAt values:
  `1793711400636`, `1793711433347`, `1793711465380`.
  These are Risk source snapshot timestamps, not V4 strategy decision ticks.
- Each audit had fresh signed GET: positions 0, open orders 0. Orders/cancels/
  position changes sent by the procedure: all 0. Frozen peer PIDs/SHA/metadata,
  pending digest and Kill digest were unchanged. Kill remains HOLD_PROTECTED.
- Only the Risk pin/current-plan entry and three Risk-specific health/watchdog
  env keys changed. Other Runner units were not restarted.

Ruling: the no-order prestart must distinguish one-use cutover approval from
continuing the same committed deployment. A 5-minute approval must not become
a perpetual restart outage; an old Risk snapshot after reboot is inherited
latch evidence, never a fresh order-permission proof.

- Follow-up helper component `c4f22cd2029875fb77b6989e4ffdb4e68663657d` is deployed
  without restarting the Writer. CI 5/5 and actual Linux fixtures 68/68 pass.
- Actual read-only prestart now verifies the original unchanged approval,
  consumed nonce, committed three-cycle receipt, exact same no-order Risk SHA,
  live pin/current-plan consistency and inherited hash/latch. Status:
  SHARED_RISK_COMMITTED_NO_ORDER_RESTART_READY. The approval was not re-dated.
- Component versions/hashes are in
  `/usr/local/libexec/disdex-unified/shared-risk-executor-current.json`.
  The original base install marker is preserved; do not label every installed
  helper or every Runner with the new source SHA.

## Remaining all-runner recovery work (not completed by this scope)

1. V4 production still failed at 53a0; separate GET-only monitor is at 89a.
   ab8 candidate is staged/CI-passed, but bounded v4 certificate issuance,
   state-lineage cutover and formal order enable remain to implement/verify.
2. V52 trading still 4d33. 7b monitor preflight is not a complete strategy
   decision cycle. #423 must gain the real root adapter and independent FET
   approval validation; do not fabricate Actions actor/run IDs.
3. Continuous pending reconciliation remains unresolved. Existing one-shot
   root reconciliation is genuine signed GET; do not fake SSH metadata in a
   timer or simply re-stamp stale pending. A scoped committed maintenance
   authority with fresh GET/account-lock proof is needed.
4. Cause-fixed, formally gated reevaluation of the V52-owned recoverable Kill
   hold remains. No forced file clear or automatic all-runner order enable.
5. Canonical real ticks, decision-to-order verification and authenticated HP
   audit must cover all Runners before any all-runner LIVE_VERIFIED claim.
