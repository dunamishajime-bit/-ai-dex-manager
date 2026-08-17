# V12 Codex Minimal VPS Handoff — 2026-08-20

## Scope

Do **not** redesign or reimplement V12. Source implementation, Aster execution lifecycle, resident protection, crash/restart recovery, shared risk, account priority/reservations, PENGU/V52 service separation, immutable release tooling, migration orchestration and final runtime verification are already in the implementation branch.

Codex's job is VPS-only unless the three-way VPS delta audit proves that the current `80a4...` release contains a production-only change that is not preserved in source.

## Fixed identities

Repository:

`dunamishajime-bit/-ai-dex-manager`

Implementation branch:

`chatgpt/v12-live-adapter-final-20260817`

Three-way comparison base:

`d686f6dc0b841ba6299830fe8aade797420f4597`

Reported current VPS release marker:

`80a4d0a687115fefbb14655b94a94b99ad52523b`

Desired LIVE composition:

`V12_X1.00_ALL + PENGU DUAL LS V2 + V52`

No SHADOW observation phase. No synthetic LIVE test order.

## Step 1 — use an existing trusted deploy-owned Git clone

Find the existing VPS clone for this repository and set:

```bash
SOURCE_REPO=/absolute/path/to/existing/trusted/-ai-dex-manager-clone
```

Do not reset, clean, delete or overwrite local changes.

Fetch the implementation branch as `deploy`:

```bash
sudo -u deploy git -C "$SOURCE_REPO" fetch origin chatgpt/v12-live-adapter-final-20260817
CANDIDATE_SHA="$(sudo -u deploy git -C "$SOURCE_REPO" rev-parse refs/remotes/origin/chatgpt/v12-live-adapter-final-20260817)"
BASE_SHA=d686f6dc0b841ba6299830fe8aade797420f4597
[[ "$CANDIDATE_SHA" =~ ^[0-9a-f]{40}$ ]]
sudo -u deploy git -C "$SOURCE_REPO" cat-file -e "${CANDIDATE_SHA}^{commit}"
sudo -u deploy git -C "$SOURCE_REPO" cat-file -e "${BASE_SHA}^{commit}"
printf 'candidate=%s\nbase=%s\n' "$CANDIDATE_SHA" "$BASE_SHA"
```

The candidate must be the exact green implementation-branch HEAD. Do not use a PR merge ref, abbreviated SHA or dirty worktree content.

## Step 2 — materialize only the canonical activation command from that exact SHA

```bash
TOOL_ROOT="/home/deploy/disdex-v12-final-tool-$CANDIDATE_SHA"
sudo -u deploy mkdir -m 0700 "$TOOL_ROOT"
sudo -u deploy git -C "$SOURCE_REPO" archive "$CANDIDATE_SHA" \
  scripts/ops/root/disdex-v12-live-activate-from-sha-final | \
  sudo -u deploy tar -x -C "$TOOL_ROOT"
ACTIVATE="$TOOL_ROOT/scripts/ops/root/disdex-v12-live-activate-from-sha-final"
bash -n "$ACTIVATE"
```

**Do not use `disdex-v12-live-activate-from-sha`; the canonical reviewed path is the `-final` command above.**

## Step 3 — execute the complete exact-SHA activation

```bash
sudo bash "$ACTIVATE" \
  "$SOURCE_REPO" \
  "$CANDIDATE_SHA" \
  "$BASE_SHA" \
  I_ACKNOWLEDGE_V12_EXACT_SHA_LIVE_ACTIVATION
```

That single command performs:

1. exact Git-object validation;
2. immutable release construction from `git archive <candidate-sha>`;
3. V12/PENGU/account-lock/V52 offline validation with production credentials removed;
4. Linux production build verification;
5. base vs current VPS vs candidate three-way release audit;
6. inert systemd/env installation only if VPS delta preservation passes;
7. V12/PENGU shared-risk refresh and all pre-stop readiness checks;
8. V96 flat/open/pending/protection checks;
9. V96 stop;
10. Aster post-stop re-query;
11. full-universe Margin Guard start;
12. PENGU V2 + V52 standalone restart from existing durable production state;
13. symmetric V96/V12 systemd start interlocks;
14. atomic `current` release switch;
15. V12 LIVE start;
16. V12/PENGU/V52 read-only runtime reconciliation before boot enabling;
17. boot target enable only after runtime verification;
18. final read-only LIVE verification.

The command never manufactures a strategy signal or sends a test order.

## Account execution order already implemented

For simultaneous requests inside the shared arbitration window:

1. P1 — reduce-only exit / protection
2. P2 — V52 new stock exposure
3. P3 — PENGU V2 new exposure
4. P4 — V12 new exposure

The arbitration is Node/Python cross-language. An already-held critical section is not preempted.

New exposure follows:

`lock -> exchange/state/gross reconcile -> shared reservation -> durable pending -> send -> result/reconcile -> release reservation -> unlock`

for V12, PENGU V2 and V52.

## Gross contract already implemented

- V12 + PENGU crypto Gross <= 1.5
- Stocks Gross <= 1.5
- Combined portfolio Gross <= 2.5
- V12 <= 1.0
- PENGU <= 0.75
- V52/V11/V50 caps unchanged

PENGU explicitly separates its crypto-sleeve 1.5 cap from the combined 2.5 cap; stock exposure does not incorrectly consume the crypto-only cap, but still consumes the combined cap.

## If the `80a4...` audit blocks

Do not bypass it.

If the canonical command exits with:

`VPS_RELEASE_DELTA_BLOCKED`

or

`VPS_RELEASE_DELTA_REVIEW_REQUIRED`

read the bounded report path printed by the audit. Only then:

1. identify the exact VPS-only production behavior;
2. incorporate required behavior into `chatgpt/v12-live-adapter-final-20260817` without changing frozen strategy logic;
3. create/push a new 40-character SHA;
4. require CI PASS for that new SHA;
5. fetch the new SHA to VPS;
6. rerun the canonical activation command from the beginning.

Never discard the delta by assumption.

## Required successful end state

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

If these are not all true, do not report LIVE completion.

## Prohibited

- no SHADOW observation phase;
- no synthetic LIVE test order;
- no V12 strategy changes;
- no PENGU/V52 strategy parameter changes;
- no risk/reference gate relaxation;
- no kill-switch auto-clear;
- no unknown-position auto-adopt/auto-close;
- no UNKNOWN order resubmission with a different ID;
- no STOP-less V12 position;
- no old-STOP-first cancellation;
- no simultaneous V96/V12 LIVE capability;
- no direct edit of a finalized immutable release;
- no automatic V96 rollback while any V12 position/order/pending/protection state is unresolved.
