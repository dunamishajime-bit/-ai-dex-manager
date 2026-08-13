# DisDex Research Commander

Research-only ChatGPT MCP server for the V96-successor backtest program. This service is deliberately separate from the trading application.

## Scope

The server provides bounded research inspection and orchestration only:

- `get_research_status`
- `get_completed_bt`
- `get_trade_ledger`
- `diagnose_candidate`
- `compare_lineage`
- `register_candidate`
- `launch_bt_shards`
- `get_guardrails`

The service has no generic shell, SSH, repository patching, production deploy, VPS, live-runner, credential, order, account, position, approval, or `realTradingEnabled` tool. Development/Validation evidence is the only redesign input. Confirmation/Holdout data is inaccessible to diagnostics and candidate registration.

## Authentication and configuration

`/mcp` and `/health` require a bearer token. `/` returns only non-sensitive metadata. Store the following in `/etc/disdex-research-commander.env` with `root:root` ownership and mode `0600`; never commit it:

```dotenv
MCP_AUTH_TOKEN=generate-a-long-random-bearer-token
DISDEX_RESEARCH_GITHUB_TOKEN=dedicated-fine-grained-token
GITHUB_REPO=dunamishajime-bit/-ai-dex-manager
GITHUB_RESEARCH_BRANCH=research/win80-profit-optimization-v1
GITHUB_WRITE_ENABLED=false
PORT=8789
DISDEX_RESEARCH_CACHE_DIR=/var/cache/disdex-research-commander
```

The GitHub credential is dedicated to this repository. Use only the minimum Contents/Actions permissions required by the enabled tools. Never reuse VPS, exchange, wallet, or production credentials.

## Safety boundaries

- GitHub reads are restricted to the exact repository and research branch.
- Writes are restricted to `research/commander/candidates/*.json` and the exact research BT workflow.
- `launch_bt_shards` requires an explicit `RESEARCH_ONLY_EXECUTION` acknowledgement and never exceeds five active shards.
- `register_candidate` requires an explicit `RESEARCH_ONLY_REGISTRATION` acknowledgement.
- Workflow names are exact-allowlisted; production/live/deploy/promote workflows are rejected.
- Artifact responses are cached by run, artifact, and commit SHA and never include raw confirmation/holdout data.

## Local verification

```bash
npm ci
npm run selftest
node server.mjs
```

The server listens only on `127.0.0.1:8789`. It is intended to be placed behind a dedicated HTTPS reverse proxy such as `research.professional-dismanager.net`. The `ops/` templates enable a dedicated systemd unit without touching trading services; DNS, TLS, and the secrets file are explicit deployment prerequisites.

## ChatGPT connection

After HTTPS is provisioned, add `https://research.professional-dismanager.net/mcp` as an MCP connection and provide the bearer secret through the connector UI. Do not put the secret in GitHub, source, or logs.

