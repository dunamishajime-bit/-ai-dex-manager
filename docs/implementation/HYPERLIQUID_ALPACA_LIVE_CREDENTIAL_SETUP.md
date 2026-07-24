# Hyperliquid xyz and Alpaca SIP LIVE setup

This document completes the external inputs required by the combined V96 + V13D + V11-EQ runner.

## Secret-handling rule

Never commit the following values to GitHub and never paste them into chat, issue comments, CI variables printed to logs, or screenshots:

- `ASTER_API_PRIVATE_KEY`
- `HYPERLIQUID_API_PRIVATE_KEY`
- `ALPACA_DATA_API_SECRET`
- the V96 Operator Override artifact

Store them only in `/etc/disdex/disdex-v13d-v11eq-v96.env`, owned by root with mode `0600`.

## Hyperliquid API wallet

Create and approve a new named API wallet from the Hyperliquid API page. Use a separate API wallet for this one trading process.

Environment mapping:

- `HYPERLIQUID_ACCOUNT_ADDRESS`: the funded main wallet or subaccount address whose `xyz:` positions and margin are used.
- `HYPERLIQUID_API_PRIVATE_KEY`: the private key of the approved API wallet/agent wallet. Do not put the API wallet public address in `HYPERLIQUID_ACCOUNT_ADDRESS`.
- `HYPERLIQUID_API_URL`: `https://api.hyperliquid.xyz`.

The API wallet signs only. Account and position queries must use the actual main/subaccount address.

## Alpaca stock reference

The local adapter subscribes to real-time quotes for:

- AMZN
- META
- MSFT
- NVDA
- TSLA

For real-money basis trading use `ALPACA_DATA_FEED=sip`, which provides consolidated US-exchange best bid and offer. The free IEX feed may be used only for Paper diagnostics because it is not consolidated market coverage.

The adapter keeps an in-memory latest quote and exposes:

```text
http://127.0.0.1:8797/quote?symbol=NVDA
```

Successful response:

```json
{
  "symbol": "NVDA",
  "price": 120.12,
  "timestamp": 1780000000000,
  "bid": 120.10,
  "ask": 120.14,
  "ageMs": 211,
  "receivedAt": 1780000000211,
  "source": "alpaca-sip-nbbo-mid"
}
```

`price` is the midpoint of the latest bid and ask. `timestamp` is Alpaca's original quote event time converted to Unix milliseconds. The adapter returns HTTP 503 when the quote age exceeds `DISDEX_STOCK_REFERENCE_PROXY_MAX_AGE_MS`.

## Environment file

Create the file from the repository template:

```bash
sudo install -d -m 700 /etc/disdex
sudo cp ops/env/disdex-v13d-v11eq-v96.env.example /etc/disdex/disdex-v13d-v11eq-v96.env
sudo chown root:root /etc/disdex/disdex-v13d-v11eq-v96.env
sudo chmod 600 /etc/disdex/disdex-v13d-v11eq-v96.env
sudoedit /etc/disdex/disdex-v13d-v11eq-v96.env
```

Fill these values locally:

```dotenv
HYPERLIQUID_ACCOUNT_ADDRESS=0x_MAIN_OR_SUBACCOUNT_ADDRESS
HYPERLIQUID_API_PRIVATE_KEY=0x_APPROVED_API_WALLET_PRIVATE_KEY

ALPACA_DATA_API_KEY=YOUR_ALPACA_KEY_ID
ALPACA_DATA_API_SECRET=YOUR_ALPACA_SECRET
ALPACA_DATA_FEED=sip

DISDEX_STOCK_REFERENCE_MODE=external
DISDEX_STOCK_REFERENCE_URL_TEMPLATE=http://127.0.0.1:8797/quote?symbol={symbol}
DISDEX_STOCK_REFERENCE_PRICE_PATH=price
DISDEX_STOCK_REFERENCE_TIMESTAMP_PATH=timestamp
DISDEX_STOCK_REFERENCE_TIMEOUT_MS=1500
DISDEX_STOCK_REFERENCE_PROXY_MAX_AGE_MS=1400
```

Do not enable LIVE flags until both services and the no-order preflight pass.

## Install and start the reference service

```bash
cd /home/deploy/dis-dex-manager
python3 -m venv .venv-stock
. .venv-stock/bin/activate
python -m pip install -r requirements-stock-live.txt
python scripts/disdex_stock_reference_alpaca_proxy.py --self-test

sudo cp ops/systemd/disdex-stock-reference-alpaca.service /etc/systemd/system/
sudo cp ops/systemd/disdex-v13d-v11eq-v96.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now disdex-stock-reference-alpaca.service
```

Check the local feed without printing credentials:

```bash
curl --fail --silent http://127.0.0.1:8797/health
curl --fail --silent 'http://127.0.0.1:8797/quote?symbol=NVDA'
```

The returned `ageMs` must be below 1500 during active US market quoting.

## Final no-order verification

```bash
npm run strategy:disdex-v13d-v11eq-v96:contract
npm run strategy:disdex-v13d-v11eq-v96:preflight
```

Only after preflight succeeds should the combined LIVE environment flags be enabled and the combined systemd service started.
