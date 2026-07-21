# Dis-Dex Manager V96 Production Handoff

## Current repository status

V96 historical research is tracked in PR #56. The Production runner and execution-parity implementation were merged by PR #58.

- Strategy ID: `DISDEX_V35_STRONG_RESERVED_PENGU_V96`
- V95 Weight Band TypeScript port: implemented
- V95 Strong Boost TypeScript port: implemented
- Python/TypeScript Golden Vector: approved by CI
- Signal chronology parity: approved
- Allocation parity: approved
- Aster quantity parity: approved
- Restart/recovery parity: approved
- Aster V3 order route: implemented
- V96 durable state and idempotency: implemented
- Operator Override LIVE route: implemented
- Daily equity-loss limit: implemented
- Kill Switch emergency flattening: implemented
- Repository mode: `LIVE_READY`
- Repository LIVE flag: `true`
- Forward Evidence: `NOT_APPROVED`
- VPS deployment: not performed by GitHub changes alone
- Real orders: not sent by this implementation PR

`liveTradingEnabled=true` means the repository can be promoted to LIVE only after the remaining runtime gates pass. It does not mean a VPS service is currently running.

## Frozen V96 strategy contract

- Historical PENGU target Gross: `1.15`
- Total portfolio Gross cap: `2.0`
- Minimum active PENGU clip: `0.50`
- Weight Band tolerance: `0.05`
- Portfolio turnover threshold: `0.20`
- Forced refresh: `12` completed 12-hour bars
- Strong Boost: `+30%` only under the frozen completed-bar gates
- PENGU Long and Short cannot be held simultaneously
- Short wins a same-bar conflict
- Long fails closed when Funding is unavailable
- Short does not depend on Funding

## Operator-controlled initial LIVE

Forward Evidence remains future-only. Until it is approved, LIVE requires a time-limited Operator Override.

The Override is SHA-256 bound and contains:

- exact V96 Strategy ID and configuration fingerprint;
- approved Git commit SHA;
- operator and reason;
- approval and expiry timestamps;
- explicit acceptance that Forward Evidence is incomplete;
- initial PENGU Gross cap;
- portfolio Gross cap;
- daily loss limits;
- exact operator acknowledgement.

Repository maximums for the Override route:

- validity: `72` hours;
- initial PENGU Gross: `0.15`;
- portfolio Gross: `2.0`;
- daily equity-loss limit: `2%`;
- Kill Switch action: `FLATTEN_MANAGED`.

Generate the approval after checking out the exact commit that will run:

```bash
export DISDEX_V96_APPROVED_COMMIT_SHA="$(git rev-parse HEAD)"
export DISDEX_V96_OPERATOR="operator-name"
export DISDEX_V96_OPERATOR_OVERRIDE_REASON="Initial operator-controlled V96 LIVE"
export DISDEX_V96_OPERATOR_OVERRIDE_ACKNOWLEDGEMENT="I_APPROVE_DISDEX_V96_OPERATOR_CONTROLLED_LIVE"
export DISDEX_V96_OPERATOR_OVERRIDE_HOURS=24
export DISDEX_V96_INITIAL_PENGU_GROSS=0.15
export DISDEX_V96_MAX_GROSS=2.0
export DISDEX_V96_MAX_DAILY_LOSS_PCT=2.0
# Optional stricter absolute limit:
# export DISDEX_V96_MAX_DAILY_LOSS_USD=25

npm run strategy:disdex-v96:override:create -- \
  .runtime-approval/disdex-v96-operator-override.json
```

An expired or edited Override fails validation. When an active Override expires during operation, exposure-increasing orders are blocked and managed positions are targeted to zero with reduce-only orders.

## Daily loss control

Daily risk uses account equity:

```text
walletBalance + managed/unmanaged unrealized PnL returned by Aster
```

At the first tick of each UTC day, the runner stores the day-start equity. The effective loss limit is the smaller of:

- `dayStartEquity × maximumDailyLossPct`; and
- `maximumDailyLossUsd`, when supplied.

After the limit is reached:

1. the trip is persisted in V96 state;
2. exposure-increasing orders are canceled before submission;
3. V96 target weights become zero;
4. managed positions are reduced with reduce-only orders;
5. the runner remains tripped for the rest of that UTC day.

A new UTC day establishes a new baseline only after the prior managed exposure has been resolved and operational review is complete.

## Kill Switch

Activate emergency flattening:

```bash
export DISDEX_V96_OPERATOR="operator-name"
export DISDEX_V96_KILL_SWITCH_REASON="Emergency stop reason"

npm run strategy:disdex-v96:kill-switch -- activate \
  .runtime-approval/disdex-v96-kill-switch.json
```

Deactivate after review:

```bash
export DISDEX_V96_OPERATOR="operator-name"

npm run strategy:disdex-v96:kill-switch -- deactivate \
  .runtime-approval/disdex-v96-kill-switch.json
```

An active Kill Switch forces the managed target to zero. The runner refuses a non-reduce-only emergency action. If open orders prevent safe flattening, it enters manual-review state instead of submitting another order.

## Execution-parity approval on the VPS commit

Generate parity evidence for the exact checked-out commit:

```bash
npm run strategy:disdex-v96:parity

export DISDEX_V96_PRODUCTION_COMMIT_SHA="$(git rev-parse HEAD)"
export DISDEX_V96_PARITY_REVIEWER="operator-or-reviewer"

npx tsx scripts/disdex-v96-write-execution-parity-approval.ts \
  .runtime-state/disdex-v95-golden.json \
  .runtime-approval/disdex-v96-parity.json
```

## V46 to V96 service handoff

V46 and V96 must not control the same Aster account simultaneously.

The installer checks the known V46 LIVE unit, defaulting to `disdex-v46-live.service`. When it is active, V96 LIVE installation fails unless the exact old service name is explicitly supplied.

Before handoff:

- confirm managed positions are flat;
- confirm Aster open orders are zero;
- confirm One-way Mode;
- verify V96 Override, parity file, Kill Switch file and credentials;
- preserve V46 logs and state for rollback.

The first V96 LIVE bootstrap also requires flat managed symbols and zero open orders. It sends no order on the bootstrap tick.

## VPS LIVE installation

```bash
sudo \
  DISDEX_V96_DEPLOY_MODE=live \
  DISDEX_V96_REPO_ROOT=/path/to/-ai-dex-manager \
  DISDEX_V96_OLD_SERVICE_NAME=disdex-v46-live \
  bash scripts/install-disdex-v96-systemd.sh
```

The generated service receives:

- `DISDEX_V96_RUNNER_MODE=live`;
- `DISDEX_V96_LIVE_EXECUTION_ENABLED=true`;
- the exact LIVE acknowledgement;
- parity, Forward, Override and Kill Switch paths;
- the V96 state directory.

LIVE startup requires:

1. repository `liveTradingEnabled=true`;
2. runtime mode `live`;
3. environment LIVE execution enabled;
4. exact LIVE acknowledgement;
5. approved execution parity;
6. either approved Forward Evidence or a valid Operator Override;
7. valid Aster credentials;
8. flat managed positions and zero open orders on first bootstrap;
9. no unresolved manual-review state;
10. explicit V46 service handoff when V46 LIVE is active.

## Required completion report

Do not report V96 as deployed or running unless the VPS was actually checked. The report must include:

- Git commit SHA on VPS;
- service name, PID and `systemctl` status;
- CI/self-test/typecheck/build results;
- Override expiry and artifact hash;
- parity artifact hash;
- initial PENGU Gross cap;
- daily loss limits and current daily risk state;
- Kill Switch status;
- account balance, managed positions and open orders;
- V46 handoff result;
- first submitted order and reconciliation result, if an order was actually sent;
- unresolved risks or manual-review status.
