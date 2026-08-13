# DisDex Research Commander

Research-only, authenticated MCP server. This service can inspect the allowlisted GitHub research branch and research artifacts, diagnose Development/Validation evidence, register candidates under `research/commander/candidates/`, and launch only the allowlisted research BT workflow.

It cannot access production/LIVE code, trading services, trading environment files, wallet or exchange credentials, orders, positions, accounts, approvals, Kill Switch state, or production deployment workflows. The process has no production environment file and the systemd unit is a dedicated non-login user with a read-only view of `/home` and write access only to its own state/cache directories.

## Local self-test

```powershell
cd apps/disdex-research-commander
npm install
npm run selftest
node --check server.mjs
node --check selftest.mjs
```

The self-test uses a fake GitHub client and never contacts GitHub or a VPS.

## Required environment

Copy `.env.example` to the dedicated VPS environment file `/etc/disdex-research-commander.env`, replace only the placeholders, and keep the file `root:root` mode `0600`. `MCP_AUTH_TOKEN` is the bearer secret used by the external MCP client. `GITHUB_RESEARCH_TOKEN` must be a separate fine-grained token scoped only to `dunamishajime-bit/-ai-dex-manager`; Contents/Actions Read is sufficient for read-only tools. Set `GITHUB_WRITE_ENABLED=true` only when the token has the narrowly required Contents/Actions Write permissions and candidate/BT write actions are explicitly approved.

## VPS boundary

- Install path: `/home/deploy/disdex-research-commander/`
- Service: `disdex-research-commander.service`
- Listener: `127.0.0.1:8789` only
- Public endpoint: a separate HTTPS hostname such as `https://research.professional-dismanager.net/mcp`
- Nginx configuration is a separate server block; the existing DisDex server block must not be edited in place.

The installer is `ops/research/install-research-commander.sh <immutable-release>`. It does not start the service until the dedicated environment file exists and has `root:root 0600`; it never touches production units, current symlinks, LIVE state, orders, or positions.

## MCP connection

Configure the ChatGPT App/Connector with the public HTTPS `/mcp` URL and bearer authentication. Do not commit or paste either token into GitHub or chat. The endpoint rejects unauthenticated requests and exposes eight tools through `tools/list`.

`launch_bt_shards` defaults to dry-run and refuses more than five active queued/in-progress research runs. Diagnostics reject Confirmation and Holdout stages so those windows cannot become an optimization feedback channel.

