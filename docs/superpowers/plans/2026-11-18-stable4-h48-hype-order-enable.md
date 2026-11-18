# STABLE4 H48 HYPE-only order-enable implementation plan

> **Execution note:** implement this plan in the current worktree, without
> delegating production or source changes to another agent. Do not stage the
> unrelated untracked `apps/` tree.

## Scope and invariants

- Keep the canonical GLOBAL Kill Switch `HOLD_PROTECTED/GLOBAL/active:true`.
- Permit only `HYPE_TREND_LONG` for the exact STABLE4 H48 source and plan.
- Do not modify strategy parameters, STOP policy, Shared Risk, Gross limits,
  Margin Guard, V4, Q102, PENGU, FET, IDLE, or V52 order permissions.
- Do not place, cancel, close, or test any exchange order.
- Use the official HP approval bridge, GitHub Actions environment, Root helper,
  and immutable release path.
- Existing `e0e4f1d8f22b62e9410188ef6e590a20e31f760f` remains the rollback target;
  a new source SHA will be required because the HYPE entry gate changes.

## Phase 1: failing tests first

1. Add `tests/hype-h48-order-permit.test.ts` covering:
   - exact schema, source SHA, plan SHA, scope, policy, runner, symbol and
     `ordersEnabled` binding;
   - root-owned permit expiry and immutable metadata requirements;
   - GLOBAL HOLD digest mismatch, malformed HOLD, inactive HOLD, wrong scope,
     wrong runner, wrong runtime SHA, and replayed nonce rejection;
   - valid HYPE permit allowing only a STABLE4 HYPE entry while all other
     cases remain fail-closed.
2. Add `scripts/ops/test_disdex_stable4_h48_order_enable.py` covering the Root
   helper's pure validators and transaction model:
   - approval record/token exactness;
   - existing H48 certificate validation;
   - fresh signed-read evidence shape and zero-mutation counters;
   - risk/margin/pending/writer/heartbeat checks;
   - staged permit publication and rollback on post-validation failure.
3. Add `tests/hype-h48-order-enable-workflow.test.mjs` and a CI contract test
   asserting the workflow is restricted to `master`, `disdex-production`, the
   exact HYPE operation/scope, and contains no order/cancel/test-order command.
4. Run the new tests and confirm they fail for the missing permit module/helper
   before writing production code.

## Phase 2: runtime gate

1. Add `lib/hype-h48-order-permit.ts` with a strict, duplicate-key-safe JSON
   parser and root-file metadata check. The default permit path is derived from
   the exact runtime SHA under `/etc/disdex/stable4/h48-time-only/` and can be
   overridden only by a validated production environment value.
2. The validator must read the canonical GLOBAL Kill Switch bytes and require:
   `active:true`, `action:HOLD_PROTECTED`, `scope:GLOBAL`, the exact
   `STABLE4_H48_CUTOVER` provenance, and a byte digest equal to the permit.
3. Require the H48 certificate digest, candidate SHA, plan SHA, HYPE scope,
   H48 policy, Owner approval nonce digest, expiry, and zero mutation counters.
4. Generate a Root-owned HYPE-only overlay from the already-certified
   immutable `e0e4f1d8...` source. The overlay changes only the entry hold
   decision: if the GLOBAL HOLD is active, accept a new entry only when the
   validated HYPE permit is present and unexpired; otherwise preserve the
   existing `HYPE_ZEC_SHARED_KILL_SWITCH_ACTIVE` hold behavior. The release
   bytes, exits, H48 time-only authority, STOP handling and risk gates remain
   unchanged.
5. Add a runtime self-test proving that a changed GLOBAL HOLD invalidates the
   permit before any executor method can be called.

## Phase 3: Root formal order-enable helper

1. Add `scripts/ops/deploy/disdex_stable4_h48_order_enable.py` and a Root
   wrapper/installer under `scripts/ops/root/`.
2. Bind the helper to the certified candidate SHA, exact H48 plan SHA, operation
   `HYPE_STABLE4_H48_TIME_ONLY_LIVE`, scope `HYPE_TREND_LONG`, and
   `ordersEnabled:true`.
3. Preflight, without mutation:
   - verify Root ownership/permissions of source, candidate release, H48
     certificate, approval store, GLOBAL HOLD and all runtime state;
   - verify the HYPE-specific activation artifact and current HYPE unit/PID,
     heartbeat/tick SHA, writer exclusivity and rollback target;
   - verify Shared Risk 7.5%, Margin Guard healthy, Gross limits, pending
     exposure released, account lock available, and no non-HYPE permit;
   - execute a fresh signed Aster GET child through the shared account lock,
     restricted to position/open-order/time GET endpoints; assert flat account,
     zero mutation counters, and no credential output.
4. On execute, atomically write a Root-owned immutable HYPE permit and a
   receipt containing only evidence hashes and non-secret status fields.
   Preserve the canonical GLOBAL HOLD bytes exactly.
5. Re-read the permit, certificate, HOLD, HYPE activation, heartbeat and
   signed account evidence. On any failure remove only the new permit and
   write a fail-closed rollback receipt; never clear or rewrite GLOBAL HOLD.

## Phase 4: formal GitHub Actions and approval

1. Add `.github/workflows/disdex-stable4-h48-order-enable.yml`:
   - `workflow_dispatch` only, `refs/heads/master` only, environment
     `disdex-production` only;
   - redeem the official HP approval token for the exact HYPE operation,
     source SHA, plan SHA and scope;
   - copy/install the Root helper by SHA and verify file hashes;
   - run Root preflight, then execute the permit transaction; never restart
     unrelated services or invoke exchange mutation APIs.
2. Add CI workflow coverage for TypeScript, Python, YAML contract, forbidden
   mutation strings and the HYPE-only scope.
3. Commit and push the Root helper/overlay changes and wait for CI. The
   immutable release SHA remains the certified `e0e4f1d8...`; only the
   Root-owned overlay hashes are new.
4. Publish a fresh formal HP approval request bound to the exact certified
   source, plan and HYPE scope. Do not reuse a redeemed or expired token.

## Phase 5: Production execution and verification

1. After the new Owner approval is redeemed, execute the formal order-enable
   workflow. The canonical GLOBAL HOLD must remain active throughout.
2. Verify the HYPE permit is active and all non-HYPE paths remain blocked by
   GLOBAL HOLD and/or their exact activation scopes.
3. Confirm the HYPE unit remains the single intended writer, the candidate
   SHA/PID/heartbeat match, and signed GET still reports no order/cancel/
   position mutations.
4. Observe at least three new HYPE decision ticks. A valid signal may create a
   real order naturally; do not manufacture one. If there is no signal, report
   `no natural signal` rather than submitting a test order.
5. Confirm any natural order uses the H48 time-only authority, correct gross
   and shared-risk gates, and the expected HYPE scope. If any check fails,
   revoke the permit and preserve GLOBAL HOLD.
6. Store the implementation, workflow, Root receipt, tick and verification
   evidence under `docs/implementation/` and push the final commit.

## Verification commands

- `npx tsc --noEmit`
- focused Node tests for permit/runtime/HYPE contracts
- `PYTHONDONTWRITEBYTECODE=1 python3 -B -m unittest ...` for Root helper tests
- workflow contract tests and forbidden-mutation scan
- GitHub Actions CI checks for the exact pushed SHA
- post-deploy Root read-only checks and three-cycle tick evidence
