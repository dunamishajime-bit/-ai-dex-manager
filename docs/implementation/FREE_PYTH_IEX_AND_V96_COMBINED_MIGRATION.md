# Free Pyth + Alpaca IEX reference and verified V96 combined migration

This handoff replaces the paid Alpaca SIP dependency with a fail-closed free reference and adds the missing official migration from the currently running standalone V96 state into the combined V96 + V13D + V11-EQ runtime.

## Reference architecture

Primary price:

- Pyth Core `Equity.US.{SYMBOL}/USD` through Hermes SSE;
- AMZN, META, MSFT, NVDA and TSLA;
- Pyth price and original `publish_time` are the values returned to the Stock engine.

Independent validation:

- Alpaca Basic IEX real-time quote stream;
- IEX is not averaged into the primary price;
- it is used only to reject a suspicious Pyth price.

Fail-closed defaults:

- Pyth age at most 1200 ms;
- IEX age at most 1500 ms;
- Pyth confidence interval at most 10 bps of price;
- absolute Pyth/IEX difference at most 20 bps;
- any missing, stale, wide-confidence or divergent input returns HTTP 503;
- free-reference V13D minimum projected net edge is 10 bps;
- free-reference V11-EQ minimum net edge is 20 bps.

Local output remains:

```text
http://127.0.0.1:8797/quote?symbol=NVDA
```

The public Pyth Hermes endpoint is suitable for initial operation while it remains accessible. `PYTH_API_KEY` is supported for the announced authenticated-Hermes transition. A missing or rejected Pyth key causes the local service to become degraded and blocks entries rather than falling back to IEX as the primary price.

## Why the previous handoff was correctly stopped

PR #83/#85 changed the V96 child state directory but did not provide a program that could prove that:

- the standalone V96 service had stopped;
- the old state belonged to the expected strategy and config fingerprint;
- a `pending` order was not still active or `UNKNOWN`;
- Aster had zero open orders;
- the real managed positions were unchanged during the handoff;
- the state copied into the combined directory was exactly the state reviewed by preflight.

Manual file copying therefore could not safely preserve live positions.

## Official migration behavior

Command:

```bash
npm run strategy:disdex-v13d-v11eq-v96:state:migrate
```

The command sends no orders. It requires:

```dotenv
DISDEX_V96_SOURCE_SERVICE_NAME=<existing standalone V96 systemd service>
DISDEX_V96_SOURCE_STATE_DIR=/path/to/existing/disdex-v96/state
DISDEX_V96_COMBINED_MIGRATION_ACKNOWLEDGEMENT=I_ACKNOWLEDGE_V96_COMBINED_STATE_MIGRATION
```

It performs these checks in order:

1. `systemctl` confirms the standalone V96 service is not active.
2. `runner-live.json` must be schema 2, LIVE, established, free of manual review and on the exact expected V96 fingerprint.
3. An unsubmitted `planned` pending order is cleared with an audit record.
4. A submitted pending order is reconciled by its existing client order ID.
5. A fully filled or terminal zero-fill order is recorded and cleared.
6. `UNKNOWN`, `NEW`, partial fill or any incomplete result stops migration.
7. Aster must return zero open orders.
8. Current BTC/ETH/BNB/SOL/PENGU position quantities are frozen into the migration manifest.
9. The source state is backed up.
10. The destination state and migration manifest are written atomically with SHA-256 hashes.

No migration is overwritten automatically. A second attempt requires operator inspection and deliberate removal or archival of the failed destination artifacts.

## Deployment sequence

### 1. Pull and install while standalone V96 remains active

```bash
cd /home/deploy/dis-dex-manager
git pull origin master
npm ci
python3 -m venv .venv-stock
. .venv-stock/bin/activate
python -m pip install -r requirements-stock-live.txt
npm run strategy:disdex-v13d-v11eq-v96:contract
```

### 2. Configure the free reference

In `/etc/disdex/disdex-v13d-v11eq-v96.env`:

```dotenv
PYTH_HERMES_URL=https://hermes.pyth.network
PYTH_API_KEY=
DISDEX_PYTH_MAX_AGE_MS=1200
DISDEX_IEX_MAX_AGE_MS=1500
DISDEX_PYTH_MAX_CONFIDENCE_BPS=10
DISDEX_REFERENCE_MAX_CROSS_SOURCE_BPS=20

ALPACA_DATA_API_KEY=<secret>
ALPACA_DATA_API_SECRET=<secret>
ALPACA_DATA_FEED=iex

DISDEX_STOCK_REFERENCE_MODE=external
DISDEX_STOCK_REFERENCE_URL_TEMPLATE=http://127.0.0.1:8797/quote?symbol={symbol}
DISDEX_STOCK_REFERENCE_PRICE_PATH=price
DISDEX_STOCK_REFERENCE_TIMESTAMP_PATH=timestamp
```

Install and start only the reference service. This does not stop V96 or send orders:

```bash
sudo cp ops/systemd/disdex-stock-reference-free.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now disdex-stock-reference-free.service
curl --fail --silent http://127.0.0.1:8797/health
curl --fail --silent 'http://127.0.0.1:8797/quote?symbol=NVDA'
```

The quote endpoint is expected to fail closed outside active U.S. stock quoting or whenever either source is stale.

### 3. Prepare the migration variables

Identify the actual existing V96 systemd unit and actual state directory. Do not guess either value.

```dotenv
DISDEX_V96_SOURCE_SERVICE_NAME=<actual existing V96 unit>
DISDEX_V96_SOURCE_STATE_DIR=<actual existing V96 state directory>
DISDEX_V96_COMBINED_MIGRATION_ACKNOWLEDGEMENT=I_ACKNOWLEDGE_V96_COMBINED_STATE_MIGRATION
```

### 4. Stop old V96 and migrate

```bash
sudo systemctl stop "$DISDEX_V96_SOURCE_SERVICE_NAME"
systemctl is-active "$DISDEX_V96_SOURCE_SERVICE_NAME" && exit 1 || true
npm run strategy:disdex-v13d-v11eq-v96:state:migrate
```

Do not restart the old service after a migration manifest has been created. Restarting it could change positions or pending state and correctly causes combined preflight to fail.

### 5. Run no-order combined preflight

Set the exact current deployed commit SHA and the existing V96 live approvals, then run:

```bash
npm run strategy:disdex-v13d-v11eq-v96:preflight
```

Preflight sends no orders and verifies:

- the destination state is established and contains no pending/manual-review state;
- its SHA still matches the migration manifest before first activation;
- the Aster account matches the migrated account;
- the live managed positions exactly match the migration snapshot;
- Aster has zero open orders;
- all existing V96 live gates pass;
- Pyth and IEX references for all five stock symbols are fresh and mutually consistent;
- Aster Stock and Hyperliquid `xyz:` credentials, symbols and equity checks pass;
- the shared Kill Switch is inactive.

### 6. Start the combined service

```bash
sudo cp ops/systemd/disdex-v13d-v11eq-v96.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now disdex-v13d-v11eq-v96.service
```

The combined supervisor writes an activation marker before starting either child. Later restarts require the same migration ID. It does not require the state file to remain byte-identical after activation because the live V96 child must update it normally.

## Rollback discipline

If migration or preflight fails:

- combined LIVE must remain stopped;
- do not delete the failure evidence;
- inspect pending/open orders and actual positions;
- do not restart the standalone V96 service until its old state has been reconciled with the current account state;
- never run standalone V96 and combined V96 simultaneously.

The migration and preflight scripts intentionally do not automate unsafe rollback across a potentially changed real-money account.
