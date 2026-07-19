# Codex VPS Handoff — Dis-Dex Manager V35

## Objective

Update the VPS repository to the promoted Dis-Dex main strategy module `DISDEX_RESILIENT_PROFIT_MAIN_V35` in **shadow-only mode**.

This handoff does not authorize order placement, account changes, leverage changes, process replacement, or stopping any existing production process.

## Safety boundaries

Do not:

- stop, restart, replace, or reconfigure existing production processes unless a separate explicit instruction identifies the exact process
- modify `.env`, API keys, wallet addresses, private keys, account settings, open positions, or orders
- set `WIN80_RUNNER_MODE=live`
- set `WIN80_LIVE_EXECUTION_ENABLED=true`
- set any `MAIN_STRATEGY_REAL_TRADING_ENABLED` value to true
- run the legacy `strategy:live:daemon` and describe it as V35
- route V35 decisions into the legacy one-way-long Win80 runner

The legacy runner cannot faithfully execute the BTC Bear Short and PENGU Short parts of V35. It must remain separate.

## Repository update

From the Dis-Dex Manager VPS checkout:

```bash
cd /home/deploy/dis-dex-manager
# Use the actual existing checkout path when different.
git status --short
git fetch origin
git checkout master
git pull --ff-only origin master
npm ci
```

Do not discard local VPS changes. If the working tree is not clean, stop the deployment and report the exact diff instead of resetting it.

## Required verification

```bash
npm run strategy:disdex-v35:selftest
npm run strategy:live:typecheck
npm run build
```

Expected self-test output:

```text
DISDEX_RESILIENT_PROFIT_MAIN_V35_SELFTEST_OK
```

Confirm that:

- `config/mainStrategy.ts` selects `DISDEX_RESILIENT_PROFIT_MAIN_V35`
- `ACTIVE_MAIN_STRATEGY_MODE` is `SHADOW`
- `ACTIVE_MAIN_STRATEGY_REAL_TRADING_ENABLED` is `false`
- `DISDEX_RESILIENT_PROFIT_MAIN_V35.shadowOnly` is `true`
- `DISDEX_RESILIENT_PROFIT_MAIN_V35.realTradingDefaultEnabled` is `false`

## Shadow plan smoke test

```bash
npm run strategy:disdex-v35:shadow -- \
  --input research/disdex-v35-shadow-snapshot.example.json
```

The output must contain:

```json
{
  "activeMainStrategyId": "DISDEX_RESILIENT_PROFIT_MAIN_V35",
  "activeMode": "SHADOW",
  "realTradingEnabled": false,
  "orderExecutionAttempted": false
}
```

For the bundled example, the plan should resolve to `STRONG_BULL`, core multiplier `1.4`, PENGU gross `0.3`, and final gross approximately `1.56`.

## Existing services

Inspect only:

```bash
ps -ef | grep -E 'win80|disdex|node|tsx' | grep -v grep
```

Do not terminate or restart any existing runner merely because master changed. Record the existing process IDs and commands in the completion report.

V35 currently has no authorized real-trading daemon. Deploying this commit means repository code, tests, documentation, and the shadow planning CLI are updated. It does not mean replacing the existing live runner.

## Completion report

Report:

- pulled master commit SHA
- clean/dirty working-tree status before and after
- `npm ci` result
- V35 self-test result
- live-runner typecheck result
- production build result
- shadow smoke-test result
- existing process IDs and commands
- confirmation that no process, account setting, `.env`, position, order, or live flag was changed

## Later implementation boundary

A separate reviewed change is required to create a dedicated V35 portfolio runner supporting:

- V28 ETH/BNB/SOL Bull core
- BTC Bear Short hedge
- independent PENGU Long/Short sleeve
- total-gross cap enforcement across all legs
- reduce-only close/rebalance logic
- account reconciliation and restart idempotency
- fresh-forward promotion gates

Do not implement or activate that real-trading runner as part of this VPS repository update.
