# V12 LIVE Activation Runbook — 2026-08-20

## Objective

Complete the production transition from the currently reported `V96 + PENGU V2 + V52` composition to:

`V12_X1.00_ALL + PENGU V2 + V52`

This runbook begins only after the source branch CI is green. It is intentionally VPS-focused: implementation, lifecycle, resident protection, restart recovery, shared crypto risk, service separation, installer, migration orchestration and final runtime verification are already encoded in the repository.

There is **no SHADOW observation phase**. There are also **no synthetic LIVE test orders**. Natural strategy signals are the only allowed source of production orders after activation.

## Fixed source identity

Repository: `dunamishajime-bit/-ai-dex-manager`

Implementation branch:

`chatgpt/v12-live-adapter-final-20260817`

Three-way VPS delta audit Git base:

`d686f6dc0b841ba6299830fe8aade797420f4597`

The candidate SHA is the exact 40-character HEAD of the implementation branch after all required CI is green. Do not substitute a merge ref, abbreviated SHA, worktree content or an uncommitted local modification.

## Expected existing VPS state

Reported current release marker:

`80a4d0a687115fefbb14655b94a94b99ad52523b`

Reported active composition:

- V96
- PENGU V2
- V52

Do not stop V96 merely to inspect or build the candidate release. Release construction, delta audit and installer are designed to be inert.

## 1. Resolve a trusted existing Git clone

Use an existing VPS Git clone owned/readable by `deploy`. Do not overwrite the running immutable release and do not convert `/home/deploy/disdex-trading/current` into a working tree.

A likely existing clone should be located and verified by its Git remote. Set:

```bash
SOURCE_REPO=/absolute/path/to/existing/trusted/-ai-dex-manager-clone
```

Verify:

```bash
sudo -u deploy git -C "$SOURCE_REPO" remote -v
sudo -u deploy git -C "$SOURCE_REPO" status --porcelain=v1
```

A dirty worktree does not contaminate release creation because the builder uses `git archive <exact-sha>`, but do not delete or reset local changes.

## 2. Fetch the implementation branch without changing the running checkout

```bash
sudo -u deploy git -C "$SOURCE_REPO" fetch origin chatgpt/v12-live-adapter-final-20260817
CANDIDATE_SHA="$(sudo -u deploy git -C "$SOURCE_REPO" rev-parse refs/remotes/origin/chatgpt/v12-live-adapter-final-20260817)"
BASE_SHA=d686f6dc0b841ba6299830fe8aade797420f4597
printf 'candidate=%s\nbase=%s\n' "$CANDIDATE_SHA" "$BASE_SHA"
[[ "$CANDIDATE_SHA" =~ ^[0-9a-f]{40}$ ]]
```

Confirm the exact candidate is a commit:

```bash
sudo -u deploy git -C "$SOURCE_REPO" cat-file -e "${CANDIDATE_SHA}^{commit}"
```

## 3. Materialize candidate tooling without changing the trusted clone checkout

```bash
TOOL_DIR="/home/deploy/disdex-v12-tool-$CANDIDATE_SHA"
sudo -u deploy git -C "$SOURCE_REPO" worktree add --detach "$TOOL_DIR" "$CANDIDATE_SHA"
```

Verify:

```bash
[[ "$(sudo -u deploy git -C "$TOOL_DIR" rev-parse HEAD)" == "$CANDIDATE_SHA" ]]
```

## 4. Build the immutable release from the exact Git object

```bash
sudo bash "$TOOL_DIR/scripts/ops/root/create-disdex-v12-immutable-release" \
  "$SOURCE_REPO" \
  "$CANDIDATE_SHA"
```

Required result:

```text
V12_IMMUTABLE_RELEASE_BUILD_PASS
linuxBuild=PASS
v12Selftest=PASS
ordersSent=false
servicesChanged=false
currentChanged=false
```

The builder performs `npm ci`, V12 typecheck/self-tests, Python V12/V52 self-tests and Linux `next build`, then publishes only the completed tree as:

```text
/home/deploy/disdex-trading/releases/<CANDIDATE_SHA>
```

It also creates:

- `.disdex-release-sha`
- `.disdex-release-source-tree`
- `.disdex-release-source-files.sha256`

Do not edit the finalized release directly.

## 5. Three-way audit the current `80a4...` release before installation

This is mandatory because the reported current marker is not known to be a GitHub commit.

```bash
RELEASE="/home/deploy/disdex-trading/releases/$CANDIDATE_SHA"
sudo bash "$TOOL_DIR/scripts/ops/disdex-v12-current-release-delta-audit.sh" \
  /home/deploy/disdex-trading/current \
  "$RELEASE" \
  "$SOURCE_REPO" \
  "$BASE_SHA"
```

Interpretation:

- `VPS_RELEASE_DELTA_PRESERVATION_PASS`: proceed.
- `VPS_RELEASE_DELTA_BLOCKED`: at least one VPS-side production change would be lost. Stop. Incorporate it into the implementation branch, create a new 40-char SHA, rerun CI, then rebuild a new immutable release.
- `VPS_RELEASE_DELTA_REVIEW_REQUIRED`: the current VPS release and candidate both changed the same production-critical file relative to the Git base. Review that exact bounded report. If the VPS behavior is still required, incorporate it into source and create a new SHA. Do not guess or discard it.

The audit is read-only, reads no `/etc/disdex` credentials and submits no orders.

## 6. Install V12/PENGU/V52 units and policy — inert only

Only after the three-way audit is resolved:

```bash
sudo bash "$RELEASE/scripts/ops/root/install-disdex-v12-live" "$RELEASE"
```

Required result:

```text
V12_LIVE_COMPONENTS_INSTALL_PASS
existingV96ServiceChanged=false
servicesStarted=false
ordersSent=false
```

At this point V96 remains untouched and LIVE.

## 7. Execute the complete V96 → V12 migration

Do not manually reproduce individual stop/start commands. The migration script encodes the required order and fail-closed boundaries.

```bash
sudo bash "$RELEASE/scripts/ops/root/disdex-v96-to-v12-live-migrate" \
  "$CANDIDATE_SHA" \
  I_ACKNOWLEDGE_V96_TO_V12_LIVE_MIGRATION
```

The script performs, in order:

1. fresh shared crypto risk refresh;
2. V12 LIVE readiness;
3. PENGU V2 readiness;
4. V12-aware V52 readiness;
5. V96 migration preflight;
6. V96 stop only after all pre-stop gates pass;
7. systemd PID-zero and orphan-process verification;
8. Aster post-stop V96 position/open-order recheck;
9. V96/V12 mutual-exclusion check;
10. full 15-crypto-symbol + stock Margin Guard start;
11. standalone PENGU V2 and V52 restart using their existing durable state;
12. immediate restart/crash-loop checks;
13. old V96 boot units disabled;
14. atomic `/home/deploy/disdex-trading/current` switch to candidate release;
15. V12 start with restart reconciliation before signal evaluation;
16. read-only `pre-enable` V12/PENGU/V52 runtime verification;
17. new target enabled only after runtime verification passes;
18. final read-only runtime verification.

The migration does not manufacture an entry signal and does not send a test order.

## 8. Required final result

The migration must end with:

```text
STATUS: LIVE_ACTIVATED
V96_STOPPED=TRUE
V12_LIVE_STARTED=TRUE
PENGU_V2_RUNNING=TRUE
V52_RUNNING=TRUE
V12_RUNTIME_RECONCILIATION_PASS=TRUE
V96_V12_SIMULTANEOUS_LIVE=FALSE
V12_BOOT_TARGET_ENABLED=TRUE
ORDERS_SENT_FOR_TESTING=0
```

It must also have emitted the final status report result:

```text
STATUS: LIVE_ACTIVATED_VERIFIED
V12_RUNTIME_RECONCILIATION_PASS=TRUE
PENGU_V2_READINESS_PASS=TRUE
V52_READINESS_PASS=TRUE
```

## 9. Re-run the read-only final status report if evidence needs to be collected again

```bash
sudo bash "$RELEASE/scripts/ops/root/disdex-v12-live-status-report" "$CANDIDATE_SHA" final
```

This verifies current SHA, boot target, V96 absence, V12/PENGU/V52/risk/Margin Guard services, V12 durable-state vs Aster position/protection consistency, PENGU readiness and V52 read-only readiness. It does not send or cancel orders.

## 10. Failure policy

Never weaken a gate to make activation pass.

Do not:

- add a SHADOW observation phase;
- flip a LIVE flag and declare completion;
- start V12 while either V96 supervisor/process remains LIVE-capable;
- auto-clear a Kill Switch;
- auto-adopt or auto-close unknown positions;
- resend UNKNOWN orders with a different ID;
- remove the resident STOP requirement;
- cancel an old trailing STOP before the replacement is confirmed;
- increase Gross/daily-loss/reference-quality limits;
- directly edit a finalized immutable release;
- create a synthetic LIVE test order;
- discard an unresolved `80a4...` VPS delta.

If migration fails after V12 has started, do not automatically restart V96. V12/Aster actual position, pending order and resident protection state must be reconciled first. The migration script intentionally refuses automatic V96 rollback in this state.

## 11. Cleanup after successful activation

Only after `LIVE_ACTIVATED_VERIFIED`:

```bash
sudo -u deploy git -C "$SOURCE_REPO" worktree remove "$TOOL_DIR"
```

Do not delete the active immutable release or the current symlink target.
