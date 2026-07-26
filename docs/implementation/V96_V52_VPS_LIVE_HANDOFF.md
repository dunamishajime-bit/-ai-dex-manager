# V96 + V52 VPS LIVE handoff

## Runtime architecture

- Crypto child: Production V96, Gross cap 1.0.
- Stock child: V52 Aster-only dual slot.
  - V11-EQ signal 10:00 New York, entry 10:30, maximum Gross 1.0.
  - V50 frozen candidate `POST_EARLY3__B75__H3__BOTH__NONE` at 11:30, 12:30 and 13:30 New York.
  - V50 maximum Gross 1.0, but it receives only remaining Stock capacity. When V11 is Gross 1.0, V50 is capped at Gross 0.5.
- Stock combined Gross cap 1.5.
- Account Gross cap 2.5.
- Same-symbol V11/V50 overlap is forbidden.
- No forced replacement and no sleeve lending.
- V13D and Hyperliquid remain disabled.

## Safety gates

Merging or pulling the code cannot submit orders. The environment template is Paper/disabled. LIVE requires all of the following:

1. Existing verified standalone-V96 to combined-state migration is complete.
2. The old standalone V96 and old combined V11 service are stopped.
3. Shared Kill Switch is inactive.
4. V96 exact-commit, execution-parity, Forward-evidence and Operator Override gates pass.
5. Pyth primary and Alpaca IEX validation service is healthy.
6. V52 no-order preflight passes with reconciled Aster positions and zero open Stock orders.
7. `DISDEX_V52_ASTER_ONLY_LIVE_EXECUTION_ENABLED=true`.
8. `DISDEX_V52_ASTER_ONLY_LIVE_ACKNOWLEDGEMENT=I_ACCEPT_REAL_MONEY_V96_V52_ASTER_ONLY`.

When the existing Stock state contains a live legacy `position` from V11-EQ, the V52 engine backs it up and migrates it into the `positions.V11_EQ` slot only when both are explicitly set:

```bash
DISDEX_V52_ALLOW_V11_STATE_MIGRATION=true
DISDEX_V52_STATE_MIGRATION_ACKNOWLEDGEMENT=I_ACKNOWLEDGE_V11_TO_V52_STATE_MIGRATION
```

A legacy non-V11 position, conflicting state, unresolved pending order, unknown Stock inventory or quantity mismatch fails closed.

## VPS installation while the current service remains active

```bash
cd /home/deploy/dis-dex-manager
git fetch origin
git checkout feature/v96-v52-dual-slot-live
npm ci
python3 -m pip install -r requirements-stock-aster-only.txt
npm run strategy:disdex-v52:contract
```

Do not stop the current service until the contract command passes.

Install the environment file without committing credentials:

```bash
sudo install -d -m 0750 /etc/disdex
sudo cp ops/env/disdex-v13d-v11eq-v96.env.example /etc/disdex/disdex-v13d-v11eq-v96.env
sudo chown root:deploy /etc/disdex/disdex-v13d-v11eq-v96.env
sudo chmod 0640 /etc/disdex/disdex-v13d-v11eq-v96.env
sudoedit /etc/disdex/disdex-v13d-v11eq-v96.env
```

Keep these values disabled during installation:

```bash
DISDEX_V13D_V11EQ_V96_RUNNER_MODE=paper
DISDEX_V52_ASTER_ONLY_LIVE_EXECUTION_ENABLED=false
DISDEX_V96_LIVE_EXECUTION_ENABLED=false
```

## Controlled cutover

Identify the actual unit names first:

```bash
systemctl list-units --type=service | grep -E 'disdex|v96|v11'
```

Stop the old standalone/combined trading service. Do not stop the local Pyth/IEX reference service:

```bash
sudo systemctl stop <OLD_TRADING_UNIT>
sudo systemctl is-active <OLD_TRADING_UNIT> && exit 1 || true
```

If the official V96 combined migration has not already been completed, run it exactly as documented in `FREE_PYTH_IEX_AND_V96_COMBINED_MIGRATION.md`.

Run the combined no-order preflight:

```bash
cd /home/deploy/dis-dex-manager
set -a
source /etc/disdex/disdex-v13d-v11eq-v96.env
set +a
npm run strategy:disdex-v52:preflight
```

The expected status is:

```text
DISDEX_V96_V52_LIVE_PREFLIGHT_PASS_NO_ORDERS_SENT
```

The preflight reports current Crypto, Stock and total Gross. It must not exceed 1.0, 1.5 and 2.5 respectively.

## Paper daemon before LIVE

```bash
sudo cp ops/systemd/disdex-v13d-v11eq-v96.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now disdex-v13d-v11eq-v96.service
journalctl -u disdex-v13d-v11eq-v96.service -n 200 --no-pager
```

Confirm the log contains `disdex-v96-v52-supervisor-start` and `v52-runner-start`. In Paper mode no real order is permitted.

## LIVE activation

After Paper verification, edit only the runtime gates:

```bash
DISDEX_V13D_V11EQ_V96_RUNNER_MODE=live
DISDEX_V52_ASTER_ONLY_RUNNER_MODE=live
DISDEX_V52_ASTER_ONLY_LIVE_EXECUTION_ENABLED=true
DISDEX_V52_ASTER_ONLY_LIVE_ACKNOWLEDGEMENT=I_ACCEPT_REAL_MONEY_V96_V52_ASTER_ONLY
DISDEX_V96_LIVE_EXECUTION_ENABLED=true
```

Retain the existing V96 acknowledgement and evidence paths. Run preflight again, then restart:

```bash
npm run strategy:disdex-v52:preflight
sudo systemctl restart disdex-v13d-v11eq-v96.service
sudo systemctl status disdex-v13d-v11eq-v96.service --no-pager
journalctl -u disdex-v13d-v11eq-v96.service -f
```

## Emergency stop

```bash
npm run strategy:disdex-v13d-v11eq-v96:kill-switch -- --activate --reason "operator emergency stop"
sudo systemctl stop disdex-v13d-v11eq-v96.service
```

The shared Kill Switch commands both children to cancel managed orders and flatten managed positions reduce-only.

## Rollback

1. Activate the Kill Switch and verify all managed positions are flat.
2. Stop the V52 combined service.
3. Restore the prior commit and prior environment file.
4. Restore the legacy Stock state only when the V52 state is flat. Never restore a state file over an open position.
5. Run the prior no-order preflight before restarting the old unit.

No deployment step in this document bypasses exchange reconciliation, pending-order review, Gross checks or the existing V96 activation gates.
