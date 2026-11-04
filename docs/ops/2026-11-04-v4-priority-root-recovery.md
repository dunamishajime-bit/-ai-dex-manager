# V4 priority recovery ledger

V4 runtime candidate: `2a6f27c6d2896aee420cbc44fe1ab8103750376c`.
Root control branch: `codex/shared-risk-root-executor-20261103` (PR 422).
This document records source/preflight evidence, not a LIVE success certificate.

The owner prioritizes V4 and explicitly authorizes authenticated root SSH.
The root transaction uses the existing CODEX_SSH authority contract, single-use
nonce and an exact reviewed plan hash. It does not impersonate an owner signature.

## Execution boundaries

1. Read-only preflight binds actual peer processes, approvals, account identity,
   immutable V4 release, unchanged economic source, static route/test evidence,
   and flat signed venue inventory to a stable plan.
2. Authenticated root prepares only V4 systemd/runtime files, preserves the
   durable execution journal through a signed-flat lineage migration, and issues
   a separate no-order refresh lease.
3. A short-lived, parent-bound, one-use root child grant authorizes certificate
   preparation only. Its HTTP adapter permits signed GET only. It issues fresh
   certificates and TIME37 approval through the authorized root transaction;
   it never relabels or re-dates an earlier approval.
4. The existing scoped full executor creates V4 order authority, switches only
   V4, prevents old/new double running, and requires three distinct completed
   decision ticks with fresh signed venue witnesses.
5. Failure restores only the exact obsolete HOLD cleared by this transaction;
   a new safety trip is preserved. After a candidate start attempt, ownership
   and durable data stay on the candidate and a failed candidate is masked.

Ruling: the one recoverable global HOLD caused by the repaired V52/Q102 SHA
mismatch may be cleared by this exact root-authorized recovery. This can restore
peers' existing permissions; no peer approval, source or PID is changed. An
unknown reason, changed owner, active exposure or changed peer is rejected.

Ruling: canonical operator target `DD1296_FINAL_ALLIN_10BPS` and immutable
strategy policy `V12_V4_V2_M150_D05_CORE_NATIVE` are verified separately by a
V4-only canonical prestart adapter. Approval targets are not rewritten to fit a
legacy generic gate. Actual service credentials must match the signed account.

Ruling: compare economic files after CRLF-to-LF normalization only; the prior
and candidate economic source is otherwise identical. Changed numbers or logic
are rejected. No new annual backtest condition is introduced for this recovery.

## Verification before deployment

Linux staging suite: priority 10, canonical prestart 3, signed reader 9,
full V4 cutover 41, venue witness 13, refresh authority 11, monitor cutover 7,
shared audit 11, monitor wiring 3, common root gate 42, bootstrap 4: **154 passed**.
Owner-preserving atomic replacement and symlink rejection ran on Linux, without
the Windows filesystem skips. Read-only preflight also passed on the actual VPS.
Normal shared-budget saturation remains a fail-closed result and is not bypassed.

The old SDK release 5304 is absent. The signed reader now uses the retained
immutable SDK 7b7719c65d2c6116d02463fc4603200f28e20762 already used by Production
pending maintenance, with the same shared budget/account lock and GET boundary.

## Follow-up after V4 cutover

Record the actual root transaction receipt and three tick witnesses before
claiming LIVE. Verify the scheduled refresh under actual systemd permissions.
The old global watchdog remains a separate known failure/restart-policy issue;
V4-only environment pin updates do not certify the entire watchdog. HP login
verification and other Runner repairs remain distinct from V4 backend authority.
The bounded refresh lease requires a genuine fresh root renewal when it expires;
editing expiry or copying a previous lease is forbidden.

First authorized preparation migrated the flat durable journal without deleting
its history. Certificate bootstrap then rejected the existing deploy:deploy 0660
Margin Guard file and restored the original HOLD. No runtime order activation
or V4 process switch occurred. A RED-to-GREEN regression now allows that exact
canonical Margin Guard path, uid/gid and 0660 mode only; root certificates, Kill,
other groups and world-writable files remain rejected. Linux bootstrap suite:
5 passed. A subsequent attempt must use a new exact plan and nonce; the genuine
migration receipt and still-valid refresh lease are reused without re-dating.

Second preparation issued a genuine bounded certificate and dynamic generation,
then correctly stopped before activation: the immutable certificate reader
requires its primary gid to match the certificate's root:deploy 0640 group.
Root gid 0 rejected that group even with supplementary deploy access. Keep all
certificate permissions intact and run root preparation, canonical certificate
prestart and bounded witness reads with deploy as primary gid (uid stays root).
The regression failed before this fix and passes afterward. Linux suite now
156 tests. Reuse the genuine certificate without changing its approval date.

Actual refresh next rejected a 282081-byte three-payload commit at its legacy
256 KiB input boundary (644 zero-position symbol rows). The runtime reader
already permits a 1 MiB bundle. Add a root serialization adapter before the
unchanged immutable refresh CLI: losslessly compact the same JSON to 163400
bytes, retaining all rows, values, embedded digests, timestamps and approvals.
It preserves root ownership/mode, rejects symlinks/CAS conflicts and oversized
compact output, and keeps the same flock, unit sandbox, shared API budget and
official CLI lease/risk validation. It never manufactures new evidence.
Linux suite: 160 passed, including actual-root atomic serialization; actual
Production bundle compacted in memory was structurally identical (no write).

The expired PENGU peer-stop artifact was formally retired by authenticated root
SSH after verifying expiry, active PENGU PID and unchanged valid live approval.
Its original bytes/dates remain archived under
`retired-expired-peer-stop-1793762256`; no approval was renewed or broadened.

Before the first V4 process switch, inspection found the old monitor unit is
an actual local instance file, which plain systemctl mask cannot overwrite.
The priority executor now supplies a V4-only adapter for the exact old/new unit
names: require stopped PID 0, preserve the root-owned original, atomically mask
it, and restore its exact monitor-only bytes on an authorized pre-start rollback.
It never starts anything itself and rejects peers/active processes. The new
actual Linux filesystem regression failed before implementation and passes
afterward. Current Linux suite total: 161.

Full venue witness also incorrectly required root ownership for all four
deploy-writer runtime records. Keep the root artifact reader unchanged and add
a separate four-path shared-runtime reader: exact deploy uid/gid, owner-matching
parent, mode 0600/0660, no world access, no symlinks, bounded no-follow reads.
All four actual runtime files now pass their ownership contract while the still
active HOLD correctly blocks readiness. The metadata regression failed before
the fix; Linux suite 162 passes. No V4 process/order activation occurred yet.

The first actual V4 switch started PID 2405187 and completed a healthy real
NO_NATIVE_ENTRY_CANDIDATES tick. The post-tick witness then incorrectly required
root ownership of V4's deploy-owned direct heartbeat. Full protected recovery
correctly stopped/masked the candidate, retained candidate pins/journal, and
restored the HOLD. This was not a successful LIVE certification.

Fix the direct reader by binding file ownership to the actual process UID.
Add explicit `--recover-protected` for the same candidate, with a distinct
recovery plan (not a fabricated deployment difference): existing exact live
authority/pins, protected failure journal, fresh signed flat inventory, terminal
compatible durable history, original root-owned unit backup and one-use root
nonce are all mandatory. Preserve existing approval dates and all history.
After a fresh before witness, start only that candidate and require three real
post-start decision ticks plus fresh signed witnesses; fail back to candidate
mask/protected state on error. Retained same-SHA markers before the new start
are waited past, never accepted or rewritten. Final peer/PID/approval/Writer
checks must remain unchanged. Linux suite: 167 passed, including successful
and failed recovery orchestration and same-SHA retained-marker regression.
