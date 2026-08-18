# DisDex GitHub Actions VPS Control

## Goal

Allow ChatGPT to request an allowlisted DisDex production VPS operation without Codex, ChatGPT Business Full MCP, an arbitrary remote shell, or a self-hosted runner on the public repository.

Control path:

`ChatGPT -> GitHub Issue #132 comment -> GitHub Actions -> constrained SSH key -> deploy forced command -> root allowlist -> exact-SHA V3 activation -> Actions result`

The first supported production operation is `V12_LIVE_ACTIVATE_V3`, which delegates to the canonical V3 path from PR #131. No shadow period and no synthetic LIVE test order are added.

## Security boundary

The GitHub Actions SSH key does **not** receive an interactive shell.

The public key is installed for user `deploy` with:

```text
restrict,command="/usr/local/sbin/disdex-github-actions-entry"
```

The entry command passes exactly one `SSH_ORIGINAL_COMMAND` line to a root-owned allowlist through one exact sudo rule:

```text
deploy ALL=(root) NOPASSWD: /usr/local/sbin/disdex-github-actions-control --stdin
```

`disdex-github-actions-control` rejects arbitrary shell text and currently accepts only:

```text
DISDEX_VPS_CONTROL_V1 <requestId> V12_LIVE_ACTIVATE_V3 chatgpt/v12-live-adapter-final-20260817 <targetSha> d686f6dc0b841ba6299830fe8aade797420f4597 I_ACKNOWLEDGE_V12_EXACT_SHA_LIVE_ACTIVATION_V3
```

It also:

- serializes production requests with `flock`;
- blocks replay of the same `requestId`;
- verifies the target is the current remote HEAD of the allowlisted source branch;
- fetches without reset/clean/checkout of the trusted deploy-owned clone;
- extracts the V3 activation tool from the exact target Git object;
- preserves the V3 immutable-release, full-tree delta audit, preflight/readiness, V96/V12 interlock and fail-closed behavior;
- never auto-clears the Kill Switch;
- never creates an arbitrary shell surface.

## GitHub trigger

Reserved control issue: `#132 DisDex VPS Control Requests`.

The workflow responds only when all of the following are true:

- event is a newly created comment;
- issue number is exactly `132`;
- GitHub actor is exactly `dunamishajime-bit`;
- comment author association is `OWNER`;
- first line is `DISDEX_VPS_CONTROL_V1`;
- JSON payload has exactly the expected keys;
- `execute` is boolean `true`;
- operation/ref/base SHA/acknowledgement match the allowlist;
- target SHA equals the exact remote branch HEAD;
- the canonical V3 activation script exists in the exact target SHA;
- the required source workflow set for that target SHA is completed with `success`.

Production runs use one global concurrency group with `cancel-in-progress: false`; a new request is never allowed to cancel a production run already in progress.

## Request format

ChatGPT should add this shape as a new comment to Issue #132:

```text
DISDEX_VPS_CONTROL_V1
{"requestId":"v12-20260819-001","operation":"V12_LIVE_ACTIVATE_V3","sourceRef":"chatgpt/v12-live-adapter-final-20260817","targetSha":"<40-char exact green branch HEAD>","baseSha":"d686f6dc0b841ba6299830fe8aade797420f4597","acknowledgement":"I_ACKNOWLEDGE_V12_EXACT_SHA_LIVE_ACTIVATION_V3","execute":true}
```

A request ID is single-use. Do not automatically submit a new ID after a failed production run. Diagnose the failed GitHub Actions run first.

## One-time VPS setup

Create a dedicated SSH keypair **only** for this GitHub Actions control path. Do not reuse the normal operator SSH private key.

Keep the private key off the repository. Only its public key is installed on the VPS.

From an existing trusted deploy-owned clone on the VPS, fetch the control implementation branch and extract the installer/tools from an exact reviewed commit. Then, as root, run:

```bash
bash scripts/ops/root/install-disdex-github-actions-control \
  /absolute/path/to/existing/trusted/-ai-dex-manager-clone \
  /absolute/path/to/disdex-github-actions-control.pub
```

The installer does not change the trading strategy, current release, service state, orders, positions, approvals or Kill Switch. It installs only the constrained SSH entry/control tools, one exact sudo rule, the control state directory, and the dedicated public key line.

## One-time GitHub repository settings

Configure these GitHub Actions secrets manually because the ChatGPT GitHub connector does not expose repository-secret management:

- `DISDEX_VPS_SSH_HOST` — Xserver VPS SSH hostname/IP;
- `DISDEX_VPS_DEPLOY_PRIVATE_KEY` — dedicated private key corresponding to the forced-command public key;
- `DISDEX_VPS_KNOWN_HOSTS` — pinned known_hosts entry captured and verified from the trusted operator environment.

Optional repository variable:

- `DISDEX_VPS_SSH_PORT` — omit for port 22.

Do not use `ssh-keyscan` inside the production workflow as implicit trust-on-first-use. The workflow requires the pinned known_hosts value.

## Required successful completion

The Actions SSH step is successful only if the remote output contains all of:

```text
STATUS: LIVE_ACTIVATED_VERIFIED
V96_V12_SIMULTANEOUS_LIVE=FALSE
ORDERS_SENT_FOR_TESTING=0
DISDEX_VPS_CONTROL_RESULT status=SUCCESS
```

A failed run posts a `FAILED` result to Issue #132 and performs no automatic retry.

## Future operations

Do not add a generic `run_shell(command)` operation.

Future operations such as exact-SHA deploy, status, restart, rollback, stop-live or a bounded known repair must be added as separate allowlisted operations with operation-specific schemas, acknowledgements, preconditions, replay policy and tests.
