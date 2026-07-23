# Dis-Dex V96 Core Volume50 / Turnover7.5 LIVE Handoff

## User-approved Production revision

- Strategy lineage: `DISDEX_V35_STRONG_RESERVED_PENGU_V96`
- Production revision: `CORE_VOLUME50_TURNOVER075_LIVE_R1`
- Historical evidence source: PR #73
- Core component volume floor: `0.70 -> 0.50`
- Portfolio rebalance threshold: `20% -> 7.5%`

Unchanged controls:

- completed 12-hour chronology only;
- Weight Band tolerance `5%`;
- forced refresh after `12` completed 12-hour bars;
- Bear confirmation `4` bars;
- Strong Boost, whipsaw and drawdown guards;
- total Gross cap `2.0`;
- minimum adjustment `max(5 USD, 1% account equity)`;
- PENGU signal rules unchanged;
- initial Operator Override PENGU Gross cap `0.15`;
- daily loss limit maximum `2%`;
- Kill Switch action `FLATTEN_MANAGED`;
- `closeUnmanagedPositions=false`.

## Historical evidence classification

The user-selected candidate produced the following historical research result:

- target/rebalance events: `275 -> 351` (`+27.64%`);
- Full Normal return: `+343.7621% -> +394.9737%`;
- Full Severe return: `+41.0068% -> +86.9596%`;
- maximum drawdown: `-30.7176% -> -30.2022%`;
- reused 2026H1 Normal: `+6.2177% -> +11.9909%`;
- reused 2026H1 Severe: `-5.3217% -> +1.7720%`.

This is user-approved known-history evidence, not independent Holdout evidence. The revision may use the Operator Override route, but must retain exact-commit parity, daily-loss and Kill Switch controls.

## Critical fingerprint rule

Changing the two thresholds changes the V96 Configuration Fingerprint. Therefore:

- the previous execution-parity approval is invalid;
- the previous Operator Override is invalid;
- the previous Forward Evidence is invalid for the new configuration;
- the existing state file cannot be loaded until it is explicitly migrated;
- no previous artifact may be copied or relabelled as approval for the new commit.

## Required VPS sequence when an existing V96 position is retained

The following is an operational checklist. GitHub merge alone does not perform these steps.

### 1. Stop only the V96 service

Do not stop a separate existing strategy service unless it is part of an explicit handoff.

```bash
sudo systemctl stop disdex-v96-live.service
sudo systemctl is-active disdex-v96-live.service
```

The expected result after the stop is `inactive`.

### 2. Update to the exact merged commit

```bash
cd /path/to/-ai-dex-manager
git fetch origin
git checkout master
git pull --ff-only origin master
export DISDEX_V96_RUNTIME_COMMIT_SHA="$(git rev-parse HEAD)"
git status --short
```

The working tree must be clean and the commit must be the reviewed merged SHA.

### 3. Install and run all parity tests

```bash
npm ci
npm run strategy:disdex-v96:parity
npm run strategy:disdex-v96:typecheck
npm run strategy:disdex-v46:selftest
npm run strategy:disdex-v46:typecheck
npm run strategy:disdex-v35:runner:typecheck
npm run build
```

### 4. Generate fresh exact-commit parity approval

```bash
mkdir -p .runtime-approval
DISDEX_V96_PRODUCTION_COMMIT_SHA="$DISDEX_V96_RUNTIME_COMMIT_SHA" \
DISDEX_V96_PARITY_REVIEWER="v96-volume50-turnover075-vps-parity" \
npx tsx scripts/disdex-v96-write-execution-parity-approval.ts \
  .runtime-state/disdex-v95-golden.json \
  .runtime-approval/disdex-v96-parity.json
```

Verify that the parity artifact contains the new commit SHA and new Configuration Fingerprint.

### 5. Inspect the old state before migration

```bash
STATE_FILE="$(pwd)/.runtime-state/disdex-v96/runner-live.json"
jq '{strategyId,configFingerprint,pending,manualReviewReason,bootstrapRequired,operatorOverride,forwardEvidence}' "$STATE_FILE"
```

Migration must be refused when:

- `pending` is not null;
- `manualReviewReason` is present;
- `bootstrapRequired` is not false;
- the current state fingerprint is not the explicitly supplied old fingerprint.

### 6. Migrate state while preserving managed positions

```bash
export DISDEX_V96_STATE_FILE="$STATE_FILE"
export DISDEX_V96_EXPECTED_OLD_CONFIG_FINGERPRINT="<EXACT_OLD_FINGERPRINT_FROM_STATE>"
export DISDEX_V96_CONFIG_MIGRATION_ACKNOWLEDGEMENT="I_ACKNOWLEDGE_V96_CONFIG_STATE_MIGRATION"
npm run strategy:disdex-v96:state:migrate
```

The migration:

- creates a timestamped backup;
- preserves completed executions, daily-risk state and Kill Switch audit;
- clears the old Operator Override audit;
- resets Forward Evidence for the new configuration;
- preserves `bootstrapRequired=false` so existing managed positions can be reconciled;
- sends no orders.

### 7. Generate a fresh Operator Override

```bash
export DISDEX_V96_APPROVED_COMMIT_SHA="$DISDEX_V96_RUNTIME_COMMIT_SHA"
export DISDEX_V96_OPERATOR="<OPERATOR_NAME>"
export DISDEX_V96_OPERATOR_OVERRIDE_REASON="User approved V96 Core Volume50 Turnover7.5 LIVE revision after PR 73 historical validation"
export DISDEX_V96_OPERATOR_OVERRIDE_ACKNOWLEDGEMENT="I_APPROVE_DISDEX_V96_OPERATOR_CONTROLLED_LIVE"
export DISDEX_V96_OPERATOR_OVERRIDE_HOURS=24
export DISDEX_V96_INITIAL_PENGU_GROSS=0.15
export DISDEX_V96_MAX_GROSS=2
export DISDEX_V96_MAX_DAILY_LOSS_PCT=2
npm run strategy:disdex-v96:override:create -- .runtime-approval/disdex-v96-operator-override.json
```

The Override must match the new commit and new Configuration Fingerprint.

### 8. Run migration-mode no-order preflight

```bash
DISDEX_V96_RUNNER_MODE=live \
DISDEX_V96_LIVE_EXECUTION_ENABLED=true \
DISDEX_V96_LIVE_ACKNOWLEDGEMENT="I_ACKNOWLEDGE_DISDEX_V96_LIVE_RISK" \
DISDEX_V96_RUNTIME_COMMIT_SHA="$DISDEX_V96_RUNTIME_COMMIT_SHA" \
DISDEX_V96_STATE_DIR="$(pwd)/.runtime-state/disdex-v96" \
DISDEX_V96_CONFIG_MIGRATION_MODE=true \
DISDEX_V96_EXECUTION_PARITY_FILE="$(pwd)/.runtime-approval/disdex-v96-parity.json" \
DISDEX_V96_OPERATOR_OVERRIDE_FILE="$(pwd)/.runtime-approval/disdex-v96-operator-override.json" \
DISDEX_V96_KILL_SWITCH_FILE="$(pwd)/.runtime-approval/disdex-v96-kill-switch.json" \
npm run strategy:disdex-v96:preflight
```

Required success status:

```text
DISDEX_V96_LIVE_PREFLIGHT_PASS_NO_ORDERS_SENT
```

Required fields include:

- `preflightMode=CONFIG_MIGRATION_WITH_EXISTING_MANAGED_POSITIONS`;
- `migratedStateVerified=true`;
- `openOrderCount=0`;
- exact runtime commit;
- exact new Configuration Fingerprint;
- fresh Operator Override approved.

### 9. Install/restart with migration preflight enabled

```bash
sudo env \
  DISDEX_V96_DEPLOY_MODE=live \
  DISDEX_V96_SERVICE_NAME=disdex-v96-live \
  DISDEX_V96_CONFIG_MIGRATION_MODE=true \
  DISDEX_V96_REPO_ROOT="$(pwd)" \
  bash scripts/install-disdex-v96-systemd.sh
```

Do not set `DISDEX_V96_OLD_SERVICE_NAME` equal to `disdex-v96-live`. That variable is only for an explicit handoff from a differently named service.

### 10. Verify actual LIVE state

```bash
sudo systemctl --no-pager --full status disdex-v96-live.service
sudo journalctl -u disdex-v96-live.service -n 200 --no-pager
grep -F "$DISDEX_V96_RUNTIME_COMMIT_SHA" /etc/systemd/system/disdex-v96-live.service
```

Then verify through signed exchange reads:

- current managed positions;
- zero UNKNOWN or partially filled orders;
- open-order state;
- account Gross at or below `2.0`;
- PENGU Gross at or below `0.15` while the Override route is used;
- current daily-risk state;
- Kill Switch inactive;
- first new decision reports the new Configuration Fingerprint.

## Rollback

A rollback is not a blind Git checkout because the old and new state fingerprints differ.

Required rollback sequence:

1. stop `disdex-v96-live`;
2. confirm no pending or open orders;
3. restore the timestamped pre-migration state backup;
4. checkout the exact previous runtime commit;
5. restore parity and Override artifacts generated for that previous commit;
6. run the old exact-commit no-order preflight;
7. restart and verify positions, Gross and logs.

Never edit a fingerprint or approval artifact manually.

## GitHub/VPS truth boundary

Repository implementation and CI can prove code, type, parity and safety-contract status. They do not prove that the VPS was updated, the service was restarted, or an order was sent. Actual LIVE status requires systemd, exact runtime SHA, exchange positions/open-orders and logs from the VPS.
