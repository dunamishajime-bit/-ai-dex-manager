# DisDex Research Commander

Research-only ChatGPT Plugin/MCP server for the V96-successor backtest program.

## Purpose

Turn requests such as `全通貨分析して` into a structured research workflow:

1. inspect GitHub Actions shard capacity,
2. collect completed artifact-backed BT evidence,
3. inspect Trade Ledger evidence,
4. diagnose Development/Validation failure mechanisms,
5. compare proposed logic against registered lineage to avoid minor variants,
6. register the next research candidate,
7. launch research-only GitHub Actions without exceeding five active shards.

The server deliberately does **not** expose generic shell, SSH, repository patching, production deploy, VPS, live-runner, credential, order, account, position, approval, Frozen V6/Fresh Forward V9, or `realTradingEnabled` tools.

## App archetype

`tool-only`. UI is intentionally deferred; the first goal is lower BT orchestration latency and stronger research guardrails.

## Tools

- `get_research_status` — queued/in-progress shard counts and capacity.
- `get_completed_bt` — recent completed artifact-backed Development/Validation results.
- `get_trade_ledger` — bounded trade-level artifact extraction.
- `diagnose_candidate` — deterministic D/V diagnosis before redesign.
- `compare_lineage` — similarity check against the candidate registry.
- `register_candidate` — writes only `research/commander/candidates/*.json`.
- `launch_bt_shards` — dispatches research workflow only, with a hard 5-shard cap.
- `get_guardrails` — returns the server safety boundary.

## Research policy

- Redesign source: Development and Validation only.
- Confirmation/Holdout: never used by `diagnose_candidate` or candidate registration as redesign inputs.
- No dense threshold sweep.
- No minor variant generation as a substitute for structural redesign.
- BTC role: Major Wave Ownership.
- ETH role: Relative Leadership Acceleration.
- BNB role: Relative Impulse Scout; consensus is continuation evidence, not mandatory entry evidence.
- AVAX role: Volatility Event Trader.
- SOL role: Frozen V109 opportunity + Wrong-wave Loss Controller.
- LINK role: Frozen V109 + Quality Cash/Horizon Control.

## GitHub authorization

Use a **dedicated research-only GitHub credential** limited to this repository. It needs:

- Actions: Read + Write, for status and `workflow_dispatch`.
- Contents: Read + Write, only because `register_candidate` stores JSON under `research/commander/candidates/`.

Do not reuse VPS, exchange, wallet, production, or live-runner credentials. The MCP server contains no tools that can consume them.

Recommended environment:

```bash
cp .env.example .env
export DISDEX_GITHUB_TOKEN='...'
npm install
npm run selftest
npm start
```

Health endpoint: `GET /`

MCP endpoint: `POST/GET/DELETE /mcp`

## Connect to ChatGPT

Deploy the server behind HTTPS, then add the HTTPS URL ending in `/mcp` as a ChatGPT plugin connection in Developer mode. Refresh the plugin connection after tool metadata changes.

## Write acknowledgements

Two mutating operations have explicit acknowledgements:

- `launch_bt_shards`: `RESEARCH_ONLY_EXECUTION`
- `register_candidate`: `RESEARCH_ONLY_REGISTRATION`

`launch_bt_shards` also requires `expectedShards` and refuses a dispatch when current queued/in-progress jobs plus requested shards would exceed 5.

## Candidate registry

Candidate specs are immutable by default. If `research/commander/candidates/<candidateId>.json` already exists, `register_candidate` returns `ALREADY_EXISTS` and does not overwrite it.

The registry records the D/V diagnosis reference that justified each new candidate, creating an auditable chain:

`BT evidence -> diagnosis -> candidate -> workflow run`

This is intentionally separate from production strategy configuration.
