# V12 Codex Minimal VPS Handoff V3 — FINAL PATH

**Use only this V3 handoff. Earlier activation V1/V2 drafts are superseded.**

Repository: `dunamishajime-bit/-ai-dex-manager`

Implementation branch: `chatgpt/v12-live-adapter-final-20260817`

Three-way base SHA: `d686f6dc0b841ba6299830fe8aade797420f4597`

Reported current VPS release: `80a4d0a687115fefbb14655b94a94b99ad52523b`

Target LIVE composition: `V12_X1.00_ALL + PENGU DUAL LS V2 + V52`

No SHADOW observation period. No synthetic LIVE test order.

## Codex work is VPS-only

Use an existing trusted deploy-owned clone. Do not reset/clean/delete local changes.

```bash
SOURCE_REPO=/absolute/path/to/existing/trusted/-ai-dex-manager-clone
sudo -u deploy git -C "$SOURCE_REPO" fetch origin chatgpt/v12-live-adapter-final-20260817
CANDIDATE_SHA="$(sudo -u deploy git -C "$SOURCE_REPO" rev-parse refs/remotes/origin/chatgpt/v12-live-adapter-final-20260817)"
BASE_SHA=d686f6dc0b841ba6299830fe8aade797420f4597
[[ "$CANDIDATE_SHA" =~ ^[0-9a-f]{40}$ ]]
sudo -u deploy git -C "$SOURCE_REPO" cat-file -e "${CANDIDATE_SHA}^{commit}"
sudo -u deploy git -C "$SOURCE_REPO" cat-file -e "${BASE_SHA}^{commit}"
```

Require the candidate SHA to be the exact green implementation-branch HEAD, not a PR merge SHA.

Extract only the V3 activation command from that exact object:

```bash
TOOL_ROOT="/home/deploy/disdex-v12-v3-tool-$CANDIDATE_SHA"
sudo -u deploy rm -rf "$TOOL_ROOT"
sudo -u deploy mkdir -m 0700 "$TOOL_ROOT"
sudo -u deploy git -C "$SOURCE_REPO" archive "$CANDIDATE_SHA" \
  scripts/ops/root/disdex-v12-live-activate-from-sha-v3 | \
  sudo -u deploy tar -x -C "$TOOL_ROOT"
ACTIVATE="$TOOL_ROOT/scripts/ops/root/disdex-v12-live-activate-from-sha-v3"
bash -n "$ACTIVATE"
```

Then run one command:

```bash
sudo bash "$ACTIVATE" \
  "$SOURCE_REPO" \
  "$CANDIDATE_SHA" \
  "$BASE_SHA" \
  I_ACKNOWLEDGE_V12_EXACT_SHA_LIVE_ACTIVATION_V3
```

## What V3 performs

1. validates exact Git candidate/base objects;
2. builds an immutable release from `git archive <candidate SHA>`;
3. executes V12/PENGU parity, resident STOP, crash/restart, shared-risk, cross-language lock and V52 offline tests with production credentials removed;
4. confirms Linux production build;
5. runs **full-source-tree** base/current/candidate VPS delta audit, including current-only source files while excluding generated/runtime and secret-like env/key material;
6. blocks before any installation if a current-VPS change would be lost or overlaps a candidate change differently;
7. performs inert systemd/env installation;
8. refreshes shared crypto risk and performs V12/PENGU/V52/V96 readiness;
9. requires V96 flat, no pending/open/resident protection;
10. stops V96 and re-queries Aster actual account;
11. starts full-universe Margin Guard;
12. restarts PENGU V2 and V52 from their existing durable production state;
13. disables old V96 boot paths and installs the reverse V96→V12 start interlock;
14. atomically switches `current` to the candidate release;
15. starts V12;
16. if V12 start has been attempted, never automatically restores the old `current` pointer and never automatically restarts V96;
17. read-only verifies V12/PENGU/V52 before enabling the new boot target;
18. enables the V12+PENGU+V52 target only after runtime verification;
19. performs final read-only verification.

The VPS-side extended Python self-tests use explicit `/usr/bin/python3`; the activation path does not depend on an optional `python` alias.

## Shared account order contract

Simultaneous arbitration window:

1. P1 reduce-only exit / protection
2. P2 V52 new stock exposure
3. P3 PENGU V2 new exposure
4. P4 V12 new exposure

Existing critical sections are never preempted.

For V12, PENGU and V52 new exposure:

`lock -> actual exchange/state/gross check -> reservation -> durable pending -> send -> reconcile -> release reservation -> unlock`

Strategy-owned hard-crash lock recovery requires dead PID plus matching durable evidence.

## Gross/risk contract

- V12 + PENGU crypto <= 1.5
- stock <= 1.5
- combined <= 2.5
- V12 <= 1.0
- PENGU <= 0.75
- V12+PENGU daily loss = 5% sticky same-day
- V52 daily loss = 3.5%
- reference quality gates unchanged

PENGU evaluates crypto 1.5 separately from combined 2.5.

## `80a4...` delta behavior

If V3 prints `VPS_RELEASE_DELTA_BLOCKED` or `VPS_RELEASE_DELTA_REVIEW_REQUIRED`, do not waive the result and do not continue to LIVE. Use only the bounded report printed by the audit, preserve the required VPS-only behavior in source, make a new 40-character SHA, require new CI PASS, fetch it and rerun V3 from the beginning.

## Required successful completion

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
ARTIFICIAL_LIVE_ORDERS=0
```

Anything less is not LIVE completion.
