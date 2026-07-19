# Codex VPS Handoff — V35 Core + PENGU Dual Engine V46

## Objective

Update the AsterDEX-based Dis-Dex Manager VPS checkout to the master commit containing `DISDEX_V35_CORE_PLUS_PENGU_DUAL_V46`, then run its dedicated portfolio daemon in Paper Forward mode.

This document is unrelated to GoldCat and contains no A/B-account assumption.

## Strategy stack

- V35 Core: ETH/BNB/SOL Bull rotation and BTC Bear Short hedge
- PENGU V46 Long: regime-confirmed Trend Resume
- PENGU V46 Short: confirmed 24-hour Breakdown
- PENGU Long and Short are mutually exclusive
- PENGU active gross: 0.15
- Combined portfolio gross cap: 2.00
- Direction changes close reduce-only before the opposite side can open

## Required immutable boundaries

Do not change:

- `ACTIVE_MAIN_STRATEGY_MODE = "PAPER"`
- `ACTIVE_MAIN_STRATEGY_REAL_TRADING_ENABLED = false`
- `DISDEX_V46_RUNTIME.liveTradingEnabled = false`
- `DISDEX_V46_RUNNER_MODE=paper`
- `DISDEX_V46_LIVE_EXECUTION_ENABLED=false`

Do not modify `.env`, API keys, account settings, leverage settings, positions or orders.

## Repository update

Locate the actual Dis-Dex Manager checkout. Do not assume its path.

```bash
cd <ACTUAL_DISDEX_REPOSITORY_PATH>
git status --short
git fetch origin
git checkout master
git pull --ff-only origin master
git rev-parse HEAD
```

If the working tree is dirty, stop and report the exact diff. Do not reset, stash or discard files without a separate instruction.

## Verification

```bash
npm ci
npm run strategy:disdex-v46:selftest
npm run strategy:disdex-v46:typecheck
npm run strategy:disdex-v35:runner:typecheck
npm run strategy:live:typecheck
npm run build
```

Expected V46 self-test output:

```text
DISDEX_PENGU_DUAL_ENGINE_V46_SELFTEST_OK
```

Confirm that:

```bash
grep -n 'ACTIVE_PENGU_ENGINE\|ACTIVE_PORTFOLIO_RUNNER_ID\|ACTIVE_MAIN_STRATEGY_MODE\|ACTIVE_MAIN_STRATEGY_REAL_TRADING_ENABLED' config/mainStrategy.ts
grep -n 'liveTradingEnabled\|mode:' config/disdexV46Runtime.ts
```

## Existing process discovery

Before installing the new service:

```bash
systemctl list-units --type=service --all | grep -Ei 'disdex|win80|v35|v46' || true
ps -ef | grep -E 'disdex|win80|tsx|node' | grep -v grep || true
```

Identify the exact old Dis-Dex Paper service if one exists. Do not stop a GoldCat process or any service whose ownership is uncertain.

## Install and start V46 Paper daemon

When no old Dis-Dex Paper service exists:

```bash
sudo \
  DISDEX_V46_DEPLOY_MODE=paper \
  DISDEX_V46_REPO_ROOT="$PWD" \
  DISDEX_V46_ENV_FILE="$PWD/.env" \
  DISDEX_V46_RUN_USER="$(stat -c '%U' .)" \
  bash scripts/install-disdex-v46-systemd.sh
```

When an exact old Dis-Dex V35 Paper unit was identified, provide only that exact unit name without `.service`:

```bash
sudo \
  DISDEX_V46_DEPLOY_MODE=paper \
  DISDEX_V46_REPO_ROOT="$PWD" \
  DISDEX_V46_ENV_FILE="$PWD/.env" \
  DISDEX_V46_RUN_USER="$(stat -c '%U' .)" \
  DISDEX_V46_OLD_SERVICE_NAME="<EXACT_OLD_DISDEX_PAPER_UNIT>" \
  bash scripts/install-disdex-v46-systemd.sh
```

The installer will stop the specified old Paper service before starting `disdex-v46-paper`. It will refuse Live mode.

## Required verification after start

```bash
systemctl --no-pager --full status disdex-v46-paper.service
journalctl -u disdex-v46-paper.service -n 150 --no-pager
ps -ef | grep -E 'disdex-v46|disdex-v35|win80|tsx|node' | grep -v grep || true
```

The journal must show:

- `runnerMode: "paper"`
- combined strategy ID `DISDEX_V35_CORE_PLUS_PENGU_DUAL_V46`
- PENGU side `-1`, `0` or `1`
- no real order placement
- no repeated fatal errors
- no simultaneous old and new Dis-Dex Paper daemon controlling the same Paper state

## Completion report

Report all of the following:

- pulled master commit SHA
- working-tree status before and after
- all verification command results
- old Dis-Dex Paper service name, if any
- whether it was stopped and disabled
- new service name, PID and start time
- `systemctl status`
- last 150 journal lines or a concise error-free summary
- current PENGU side and reason from the latest tick
- confirmation that Live flags, `.env`, account settings, positions and orders were not changed
