# V12 Codex Minimal VPS Handoff V2 — 2026-08-20

This supersedes earlier activation-command drafts. **Use only the V2 path named below.**

## Codex scope

No strategy redesign and no source implementation work unless the bounded three-way audit proves an unpreserved current-VPS delta.

Fixed repository:

`dunamishajime-bit/-ai-dex-manager`

Fixed implementation branch:

`chatgpt/v12-live-adapter-final-20260817`

Three-way comparison base:

`d686f6dc0b841ba6299830fe8aade797420f4597`

Reported current VPS release marker:

`80a4d0a687115fefbb14655b94a94b99ad52523b`

Desired final LIVE composition:

`V12_X1.00_ALL + PENGU DUAL LS V2 + V52`

No SHADOW observation period. No synthetic LIVE order.

## 1. Fetch only

Use an existing trusted deploy-owned clone:

```bash
SOURCE_REPO=/absolute/path/to/existing/trusted/-ai-dex-manager-clone
sudo -u deploy git -C "$SOURCE_REPO" fetch origin chatgpt/v12-live-adapter-final-20260817
CANDIDATE_SHA="$(sudo -u deploy git -C "$SOURCE_REPO" rev-parse refs/remotes/origin/chatgpt/v12-live-adapter-final-20260817)"
BASE_SHA=d686f6dc0b841ba6299830fe8aade797420f4597
[[ "$CANDIDATE_SHA" =~ ^[0-9a-f]{40}$ ]]
sudo -u deploy git -C "$SOURCE_REPO" cat-file -e "${CANDIDATE_SHA}^{commit}"
sudo -u deploy git -C "$SOURCE_REPO" cat-file -e "${BASE_SHA}^{commit}"
```

`CANDIDATE_SHA` must be the exact green branch HEAD, not the PR merge SHA and not an abbreviated SHA.

## 2. Extract the V2 canonical command from that exact Git object

```bash
TOOL_ROOT="/home/deploy/disdex-v12-v2-tool-$CANDIDATE_SHA"
sudo -u deploy mkdir -m 0700 "$TOOL_ROOT"
sudo -u deploy git -C "$SOURCE_REPO" archive "$CANDIDATE_SHA" \
  scripts/ops/root/disdex-v12-live-activate-from-sha-v2 | \
  sudo -u deploy tar -x -C "$TOOL_ROOT"
ACTIVATE="$TOOL_ROOT/scripts/ops/root/disdex-v12-live-activate-from-sha-v2"
bash -n "$ACTIVATE"
```

Do not use any earlier `activate-from-sha` variant.

## 3. One command to completion

```bash
sudo bash "$ACTIVATE" \
  "$SOURCE_REPO" \
  "$CANDIDATE_SHA" \
  "$BASE_SHA" \
  I_ACKNOWLEDGE_V12_EXACT_SHA_LIVE_ACTIVATION
```

The V2 command performs in fixed order:

1. exact candidate/base Git-object validation;
2. immutable candidate release build from `git archive <SHA>`;
3. Linux build validation;
4. V12/PENGU parity/self-tests;
5. Node/Python shared account-lock and priority self-tests;
6. V12 resident protection / restart / crash tests;
7. V12-aware V52 self-tests;
8. current-VPS vs Git-base vs candidate three-way delta audit;
9. inert component installation only after delta preservation passes;
10. fresh shared crypto risk;
11. V12/PENGU/V52 pre-stop readiness;
12. V96 flat/pending/open/protection gate;
13. V96 stop;
14. actual Aster V96 post-stop recheck;
15. full-universe Margin Guard start;
16. standalone PENGU V2 + V52 resume from existing durable state;
17. old V96 boot-disable and reverse V12→V96 start interlock;
18. atomic current-release switch;
19. V12 start with V96→V12 interlock and restart reconciliation;
20. read-only runtime verification before new target is enabled;
21. enable V12+PENGU+V52 boot target;
22. final read-only runtime verification.

## Safety change specific to V2

Once the migration has issued the first `systemctl start` that can start V12, `v12_start_attempted=true` is latched inside the migration process.

From that point onward the migration **will not automatically restore the old `current` symlink**, even if the V12 service immediately exits and reports MainPID=0. A natural strategy signal may already have created a V12 position or protection order. The candidate release remains current so reconciliation tooling stays aligned with any possible V12 exposure.

V96 is never automatically restarted after a V12 start attempt.

## Shared order priority already implemented

Same arbitration window:

1. P1 — reduce-only exit / resident protection
2. P2 — V52 stock new exposure
3. P3 — PENGU V2 new exposure
4. P4 — V12 new exposure

Already-held critical sections are not preempted.

All new exposure uses:

`lock -> actual account/state/gross check -> shared reservation -> durable pending -> send -> reconcile -> reservation release -> unlock`

V12, PENGU and V52 dead-owner lock recovery is fail-closed and requires strategy-owned durable evidence.

## Gross contract

- V12 + PENGU crypto <= 1.5
- stocks <= 1.5
- combined <= 2.5
- V12 <= 1.0
- PENGU <= 0.75

PENGU's crypto 1.5 cap and whole-account 2.5 cap are evaluated separately.

## If the `80a4...` delta audit blocks

If output contains:

`VPS_RELEASE_DELTA_BLOCKED`

or:

`VPS_RELEASE_DELTA_REVIEW_REQUIRED`

stop before install/LIVE. Read only the bounded report printed by the audit. Preserve any required current-VPS behavior in source, create and push a new SHA, require new CI PASS, fetch that exact SHA, and rerun V2 from the beginning.

Never waive the audit.

## Required completion

```text
STATUS: LIVE_ACTIVATED_VERIFIED
V96_STOPPED=TRUE
V12_LIVE_STARTED=TRUE
PENGU_V2_RUNNING=TRUE
V52_RUNNING=TRUE
SHARED_CRYPTO_RISK_RUNNING=TRUE
FULL_UNIVERSE_MARGIN_GUARD_RUNNING=TRUE
V12_RUNTIME_RECONCILIATION_PASS=TRUE
PENGU_V2_READINESS_PASS=TRUE
V52_READINESS_PASS=TRUE
V96_REVERSE_INTERLOCK_VERIFIED=TRUE
V96_V12_SIMULTANEOUS_LIVE=FALSE
V12_BOOT_TARGET_ENABLED=TRUE
ORDERS_SENT_FOR_TESTING=0
```

Nothing less is LIVE completion.
