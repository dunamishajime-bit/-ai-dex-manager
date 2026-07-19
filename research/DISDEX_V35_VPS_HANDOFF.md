# Codex VPS Handoff — Dis-Dex Manager V35 Aster Runner

## Objective

Update the Dis-Dex Manager VPS checkout and run the dedicated `DISDEX_RESILIENT_PROFIT_MAIN_V35` Aster long/short portfolio runner in **PAPER mode**.

This document concerns only the AsterDEX-based Dis-Dex Manager project. It has no relation to the former GoldCat A/B-account system.

## Why PAPER, not LIVE

The dedicated runner implementation is complete, but the Aster revalidation did not pass the production promotion gates:

- PENGU V36: no stable reproducible 72-hour rule
- PENGU V38: no ensemble passed Development, Validation and Frozen Holdout together
- V35 Core-only V37 on Aster public OHLCV/Funding: no robust candidate
- current V35 multipliers: 2023–2025 CAGR 61.2473%, MaxDD -31.7730%
- reused 2026 H1 Severe: -14.4419%

The repository therefore intentionally contains:

- `ACTIVE_MAIN_STRATEGY_MODE = "PAPER"`
- `ACTIVE_MAIN_STRATEGY_REAL_TRADING_ENABLED = false`
- `DISDEX_V35_RUNTIME.liveTradingEnabled = false`
- PENGU disabled

Do not change these flags during this deployment.

## Implemented runner

The V35 runner supports:

- V28 ETH/BNB/SOL Bull core
- four-bar-confirmed BTC Bear Short hedge
- VWM25 ranking tilt
- downside-volatility-skew scaling
- V35 Strong/Normal/Brake multipliers
- signed Long/Short target weights
- reduce-only close before changing position direction
- one order per tick
- gross-cap enforcement
- durable state, lock and idempotency
- unknown-order reconciliation
- signed futures paper portfolio

The old Win80 one-way-long runner is not V35 and must not be relabelled as V35.

## Repository update

Locate the actual Dis-Dex Manager checkout first. Do not assume a path.

```bash
find /home /opt -maxdepth 4 -type d -name .git 2>/dev/null \
  | while read gitdir; do dirname "$gitdir"; done
```

After identifying the correct repository:

```bash
cd <ACTUAL_DISDEX_REPOSITORY_PATH>
git remote -v
git status --short
git fetch origin
git checkout master
git pull --ff-only origin master
```

Do not discard local changes. When the working tree is dirty, stop and report the exact diff instead of resetting it.

## Required verification

```bash
npm ci
npm run strategy:disdex-v35:selftest
npm run strategy:disdex-v35:runner:selftest
npm run strategy:disdex-v35:runner:typecheck
npm run strategy:live:typecheck
npm run build
```

Expected test output includes:

```text
DISDEX_RESILIENT_PROFIT_MAIN_V35_SELFTEST_OK
DISDEX_V35_LIVE_RUNNER_SELFTEST_OK
```

Confirm:

```bash
grep -n "ACTIVE_MAIN_STRATEGY_MODE\|ACTIVE_MAIN_STRATEGY_REAL_TRADING_ENABLED" config/mainStrategy.ts
grep -n "liveTradingEnabled\|PENGU_EXCLUDED" config/disdexV35Runtime.ts
grep -n "paperOnly\|robustCandidateFound" lib/disdex-resilient-profit-main-v35.ts
```

The output must confirm PAPER mode, live false, PENGU excluded and robust Aster candidate false.

## Inspect the current Dis-Dex processes

```bash
ps -ef | grep -E 'disdex|win80|node|tsx' | grep -v grep
systemctl list-units --type=service --all | grep -Ei 'disdex|win80|aster'
systemctl list-unit-files | grep -Ei 'disdex|win80|aster'
```

Record all process IDs, commands and service names.

Do not stop the current live process as part of this paper deployment. V35 did not pass the live replacement gate.

## Install and start the V35 PAPER daemon

Run from the repository root:

```bash
sudo \
  DISDEX_V35_DEPLOY_MODE=paper \
  DISDEX_V35_REPO_ROOT="$PWD" \
  DISDEX_V35_ENV_FILE="$PWD/.env" \
  DISDEX_V35_RUN_USER="$(stat -c '%U' .)" \
  bash scripts/install-disdex-v35-systemd.sh
```

The installer will:

- rerun all required tests
- create `disdex-v35-paper.service`
- set `DISDEX_V35_RUNNER_MODE=paper`
- set `DISDEX_V35_LIVE_EXECUTION_ENABLED=false`
- start the signed Long/Short paper daemon
- leave the current production process running

## Verify operation

```bash
systemctl --no-pager --full status disdex-v35-paper.service
journalctl -u disdex-v35-paper.service -n 150 --no-pager
sleep 10
journalctl -u disdex-v35-paper.service -n 150 --no-pager
```

Confirm:

- the service is active
- runner mode is `paper`
- strategy ID is `DISDEX_RESILIENT_PROFIT_MAIN_V35`
- no fatal errors
- `.runtime-state/disdex-v35/paper-portfolio.json` is created after a rebalance action
- no real Aster order was submitted

## LIVE replacement is intentionally blocked

Do not use:

```bash
DISDEX_V35_DEPLOY_MODE=live
DISDEX_V35_CONFIRM_LIVE=YES
```

The installer also refuses live installation while `config/disdexV35Runtime.ts` has `liveTradingEnabled: false`.

A later explicit promotion requires all of the following:

- a robust Aster backtest candidate
- positive Severe result
- acceptable Severe drawdown
- pristine forward period
- reviewed change setting the repository live flag to true
- explicit identification and controlled stop of the exact old Dis-Dex service

## Completion report

Report:

- repository path
- pulled master SHA
- working-tree status before and after
- npm installation result
- all V35 and legacy typecheck/build results
- current Dis-Dex process IDs and service names
- `disdex-v35-paper.service` status
- recent V35 journal output
- confirmation that the existing live process was not stopped
- confirmation that no real order, position, credential, leverage or account setting was changed
