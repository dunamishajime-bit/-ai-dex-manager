# PENGU_AUDIT_FAIL_CLOSED Remediation

## Scope

This procedure closes the production boundary defect where the combined supervisor could start both legacy V96 crypto execution and `PENGU_DUAL_LS_V1`.

The procedure is deliberately fail-closed:

- do not restart the LIVE service while reconciliation is incomplete;
- do not manually edit `runner-live.json`;
- do not manually change `kill-switch.json`;
- do not submit, cancel, or flatten an exchange order as part of reconciliation;
- do not re-enable `scripts/disdex-v96-live-runner.ts` in LIVE mode.

## Code invariants

The release is acceptable only when all of the following are true:

1. Combined supervisor children are `pengu-dual-ls-v1` and `stock-v52-aster-only` only.
2. `scripts/disdex-v96-live-runner.ts` rejects `DISDEX_V96_RUNNER_MODE=live` unconditionally.
3. Combined startup preflight invokes PENGU self-test and PENGU authenticated read-only preflight, not legacy V96 startup preflight/migration.
4. PENGU state is stored in the dedicated `pengu-dual-ls-v1/runner-live.json` path.
5. Legacy V96 durable state may be read only for audit/reconciliation and portfolio daily-loss evidence.
6. Linux and Windows PENGU self-tests pass.
7. No reconciliation or kill-switch-release code calls an order submission API.

## VPS recovery sequence

Keep the service stopped throughout sections 1-4.

### 1. Confirm stopped state

```bash
sudo systemctl is-active disdex-v13d-v11eq-v96.service
sudo systemctl show disdex-v13d-v11eq-v96.service -p MainPID -p NRestarts
```

Required before continuing:

- service is not active;
- `MainPID=0`;
- no automatic restart is in progress.

### 2. Load the production environment without starting the service

```bash
set -a
. /etc/disdex/disdex-v13d-v11eq-v96.env
set +a
```

Do not change the kill switch here.

### 3. Dry-run legacy V96 reconciliation

```bash
npx tsx scripts/disdex-v96-legacy-reconcile.ts
```

The only acceptable success status is:

```text
LEGACY_V96_RECONCILE_READY_TO_APPLY
```

The dry-run must prove all of these simultaneously:

- shared kill switch is still active;
- legacy pending state is `manual_review`;
- exchange managed positions are flat;
- exchange open-order count is zero;
- the stale SOL pending order is terminal or no longer exists on the exchange;
- the BNB Margin Guard execution is verified as `SELL`, `reduceOnly=true`, `FILLED`;
- `ordersSent=false`;
- `cancelsSent=false`;
- `positionsChanged=false`.

Any other result is `FAIL_CLOSED`; stop and investigate the reported mismatch.

### 4. Apply durable-state reconciliation

Only after section 3 returns exactly `LEGACY_V96_RECONCILE_READY_TO_APPLY`:

```bash
export DISDEX_V96_RECONCILE_ACKNOWLEDGEMENT=RECONCILE_LEGACY_V96_FLAT_STATE
npx tsx scripts/disdex-v96-legacy-reconcile.ts --apply
unset DISDEX_V96_RECONCILE_ACKNOWLEDGEMENT
```

Required result:

```text
LEGACY_V96_RECONCILE_APPLIED
```

This operation may only:

- write a reconciliation audit artifact;
- clear the stale legacy `pending` and `manualReviewReason` fields;
- set legacy `bootstrapRequired=true`.

It must not send/cancel/flatten an order and must not change approvals.

### 5. Dry-run kill-switch release

```bash
npx tsx scripts/pengu-live-kill-switch-release.ts
```

The only acceptable success status is:

```text
KILL_SWITCH_RELEASE_READY
```

The script must verify:

- an applied reconciliation audit exists;
- legacy pending state is absent;
- PENGU pending state is absent;
- managed exchange positions are zero;
- all exchange open orders are zero;
- legacy V96 LIVE runner hard-retirement marker is present;
- legacy V96 environment enable is false;
- legacy PENGU Core is false.

### 6. Release kill switch without starting LIVE

Only after section 5 returns exactly `KILL_SWITCH_RELEASE_READY`:

```bash
export PENGU_KILL_SWITCH_RELEASE_ACKNOWLEDGEMENT=RELEASE_KILL_SWITCH_AFTER_RECONCILIATION
npx tsx scripts/pengu-live-kill-switch-release.ts --apply
unset PENGU_KILL_SWITCH_RELEASE_ACKNOWLEDGEMENT
```

Required result:

```text
KILL_SWITCH_RELEASED
```

This changes the shared kill-switch durable state only. It must not start a service or mutate any exchange order/position.

### 7. Run read-only final preflight

```bash
npm run strategy:disdex-v52:preflight
```

Required final status:

```text
DISDEX_PENGU_V52_LIVE_PREFLIGHT_PASS_NO_ORDERS_SENT
```

PENGU preflight must independently prove:

- kill switch inactive;
- no PENGU pending order;
- no PENGU open order;
- durable PENGU position and exchange PENGU position agree;
- any live position amount, entry price, and mark price are finite and positive;
- legacy V96 LIVE is disabled;
- legacy PENGU Core is disabled.

### 8. LIVE restart gate

Do not start LIVE unless all preceding sections passed and the exact release commit has also passed the GitHub Linux/Windows fail-closed CI.

A failed check at any stage restores the required operational state to:

```text
PENGU_AUDIT_FAIL_CLOSED / LIVE_RESTART_BLOCKED
```

The code remediation intentionally does not auto-start the service after successful reconciliation or preflight.
