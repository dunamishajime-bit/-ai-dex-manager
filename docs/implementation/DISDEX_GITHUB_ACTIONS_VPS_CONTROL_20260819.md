# DisDex GitHub Actions VPS Control

## Goal

Allow ChatGPT to request an allowlisted DisDex VPS operation without Codex, ChatGPT Business Full MCP, an arbitrary remote shell, or a self-hosted runner on the public repository.

Control path:

`ChatGPT -> GitHub Issue #132 comment -> GitHub Actions -> constrained SSH key -> deploy forced command -> root allowlist -> bounded VPS operation -> Actions result`

Supported operations:

- `CONTROL_PROBE` — end-to-end connection/config/ref verification only; no trading-service, current-release, order, position, approval or Kill Switch mutation;
- `V12_LIVE_ACTIVATE_V3` — delegates to the canonical V3 exact-SHA path from PR #131. No shadow period and no synthetic LIVE test order are added.

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

`disdex-github-actions-control` rejects arbitrary shell text and accepts only the explicit operation schemas below.

Probe:

```text
DISDEX_VPS_CONTROL_V1 <requestId> CONTROL_PROBE master <masterHeadSha> <sameMasterHeadSha> PROBE_ONLY_NO_TRADING_MUTATION
```

V12 activation:

```text
DISDEX_VPS_CONTROL_V1 <requestId> V12_LIVE_ACTIVATE_V3 chatgpt/v12-live-adapter-final-20260817 <targetSha> d686f6dc0b841ba6299830fe8aade797420f4597 I_ACKNOWLEDGE_V12_EXACT_SHA_LIVE_ACTIVATION_V3
```

The control path also:

- serializes requests with `flock`;
- persists `RUNNING` before fetch/build/install work so a hard failure leaves replay evidence;
- blocks replay of the same `requestId`;
- verifies the target is the current remote HEAD of the allowlisted source branch;
- fetches without reset/clean/checkout of the trusted deploy-owned clone;
- for LIVE activation, extracts the V3 activation tool from the exact target Git object;
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
- operation/ref/SHA/acknowledgement match an allowlisted schema;
- target SHA equals the exact remote branch HEAD;
- for V12 LIVE, the canonical V3 activation script exists in the exact target SHA and the required production source workflow set is completed with `success`.

All requests share one concurrency group with `cancel-in-progress: false`; a new request never cancels a run already in progress.

## Request formats

### First end-to-end test — CONTROL_PROBE

After the framework is merged and the one-time SSH setup is complete, ChatGPT should first obtain the current exact `master` HEAD SHA and post:

```text
DISDEX_VPS_CONTROL_V1
{"requestId":"probe-20260819-001","operation":"CONTROL_PROBE","sourceRef":"master","targetSha":"<current 40-char master HEAD>","baseSha":"<same 40-char master HEAD>","acknowledgement":"PROBE_ONLY_NO_TRADING_MUTATION","execute":true}
```

Required probe output includes:

```text
DISDEX_VPS_CONTROL_PROBE_PASS
sourceRepoReachable=TRUE
originVerified=TRUE
forcedCommand=TRUE
tradingMutation=0
DISDEX_VPS_CONTROL_RESULT status=SUCCESS
```

### V12 LIVE activation

Only after the probe succeeds, ChatGPT may post:

```text
DISDEX_VPS_CONTROL_V1
{"requestId":"v12-20260819-001","operation":"V12_LIVE_ACTIVATE_V3","sourceRef":"chatgpt/v12-live-adapter-final-20260817","targetSha":"<40-char exact green branch HEAD>","baseSha":"d686f6dc0b841ba6299830fe8aade797420f4597","acknowledgement":"I_ACKNOWLEDGE_V12_EXACT_SHA_LIVE_ACTIVATION_V3","execute":true}
```

A request ID is single-use. Do not automatically submit a new ID after a failed run. Diagnose the failed GitHub Actions run first.

## One-time VPS setup

Create a dedicated SSH keypair **only** for this GitHub Actions control path. Do not reuse the normal operator SSH private key.

Keep the private key off the repository. Only its public key is installed on the VPS.

From an existing trusted deploy-owned clone on the VPS, fetch the control implementation and run the installer as root:

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

## Required V12 LIVE completion

The V12 Actions SSH step succeeds only if remote output contains all of:

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
