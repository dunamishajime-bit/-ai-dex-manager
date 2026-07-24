# V13D + V11-EQ Stock Router + Crypto V96 — LIVE Operations Runbook

## Implementation status

This branch includes an executable combined system, not only a strategy contract.

- Crypto sleeve: existing `scripts/disdex-v96-live-runner.ts`
- Stock sleeve: `scripts/disdex_v13d_v11eq_stock_live_engine.py`
- Combined supervisor: `scripts/disdex-v13d-v11eq-v96-live-runner.ts`
- Combined no-order preflight: `scripts/disdex-v13d-v11eq-v96-live-preflight.ts`
- Shared Kill Switch: `scripts/disdex-v13d-v11eq-v96-kill-switch.ts`
- systemd unit: `ops/systemd/disdex-v13d-v11eq-v96.service`
- environment template: `ops/env/disdex-v13d-v11eq-v96.env.example`

The repository runtime is `LIVE_READY`. Real orders still require explicit environment activation, valid Aster and Hyperliquid credentials, a fresh external cash-stock reference feed, successful combined preflight, and the existing Crypto V96 exact-commit live gates.

## Fixed architecture

- Crypto V96 Gross cap: 1.0
- Stock Gross cap: 1.0
- Portfolio Gross cap: 2.0
- No sleeve lending
- Maximum one Stock position
- V13D first at 10:00 New York
- V11-EQ fallback at 10:30 only when V13D did not open
- Shared UTC daily-loss limit: 2%
- Shared Kill Switch file; active action is cancel and reduce-only flatten of managed positions
- Existing unmanaged positions are not closed

## Stock execution implementation

### V13D

- Aster Stock Perp is the Maker leg using `LIMIT` + `GTX` post-only.
- Hyperliquid `xyz:` Stock Perp is the opposite IOC hedge using the official Python SDK.
- Aster Maker fill must reach 90% within 3 seconds.
- The Hyperliquid hedge starts after the fixed 250 ms delay and must reach 99% fill.
- Incomplete hedge causes immediate flatten and shared Kill Switch activation.
- Previous completed V13D symbol is skipped once.
- 14:30 New York TP check uses 30 bps price gross; otherwise 15:00 exit and 15:10 hard-flat deadline.

### V11-EQ

- The 10:00 signal Top1 symbol is frozen.
- At 10:30 the same symbol must still be absolute-Basis Top1.
- Basis >=50 bps.
- Estimated round-trip cost <=60 bps.
- Cost/Basis <=75%.
- Estimated Net Edge >=10 bps.
- Aster depth >=2x order notional.
- Spread <=20 bps and <=2x the trailing 30-second median.
- Data and reference clock age <=1.5 seconds.
- Adverse two-second price move <=5 bps.
- Adverse Basis expansion <=10 bps.
- Entry uses Aster `LIMIT` + `GTX`, TTL 10 seconds, fill >=90%, and no market-entry fallback.
- Exit is Basis <=15 bps, zero-cross, 1.5x Basis stop, or 15:30 final exit.

## Required external cash-stock reference contract

LIVE does not use Yahoo. Configure an authenticated, fresh reference endpoint:

```text
DISDEX_STOCK_REFERENCE_MODE=external
DISDEX_STOCK_REFERENCE_URL_TEMPLATE=https://provider.example/quote?symbol={symbol}
DISDEX_STOCK_REFERENCE_PRICE_PATH=price
DISDEX_STOCK_REFERENCE_TIMESTAMP_PATH=timestamp
DISDEX_STOCK_REFERENCE_HEADERS_JSON={"Authorization":"Bearer ..."}
```

For each AMZN, META, MSFT, NVDA and TSLA request, the response must expose a positive price and epoch timestamp in milliseconds or seconds. Quotes older than 1.5 seconds fail closed.

## Installation

```bash
cd /home/deploy/dis-dex-manager
npm ci
python3 -m venv .venv-stock
. .venv-stock/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-stock-live.txt
```

Set `DISDEX_PYTHON_BIN=/home/deploy/dis-dex-manager/.venv-stock/bin/python` in the environment file when using the virtual environment.

## Migration from standalone V96

Do not run the old standalone V96 daemon and the combined supervisor simultaneously.

1. Activate the shared Kill Switch only if an emergency flatten is required.
2. Confirm there are no unknown open Stock orders or unmanaged Stock positions.
3. Stop and disable the old standalone V96 systemd service.
4. Preserve or migrate the existing V96 state under the combined Crypto state directory:
   `.runtime-state/disdex-v13d-v11eq-v96/crypto-v96`.
5. Copy the environment template to `/etc/disdex/disdex-v13d-v11eq-v96.env` with mode `0600`.
6. Install the new systemd unit.
7. Run combined preflight.
8. Start the combined service.

The existing V96 runner lock and the new Stock runner lock prevent duplicate instances.

## Paper run

Keep the default environment values:

```text
DISDEX_V13D_V11EQ_V96_RUNNER_MODE=paper
DISDEX_V13D_V11EQ_V96_LIVE_EXECUTION_ENABLED=false
DISDEX_V96_LIVE_EXECUTION_ENABLED=false
```

Then run:

```bash
npm run strategy:disdex-v13d-v11eq-v96:once
npm run strategy:disdex-v13d-v11eq-v96:daemon
```

## LIVE activation

Set all existing V96 approval files and acknowledgements, plus:

```text
DISDEX_V13D_V11EQ_V96_RUNNER_MODE=live
DISDEX_V13D_V11EQ_V96_LIVE_EXECUTION_ENABLED=true
DISDEX_V13D_V11EQ_V96_LIVE_ACKNOWLEDGEMENT=I_ACCEPT_REAL_MONEY_V13D_V11EQ_V96
DISDEX_V96_LIVE_EXECUTION_ENABLED=true
```

The existing V96 acknowledgement, exact runtime commit SHA, execution-parity file, Forward/override evidence and Kill Switch variables remain mandatory. Configure Aster and Hyperliquid account credentials and the external reference endpoint before continuing.

Run the no-order preflight:

```bash
npm run strategy:disdex-v13d-v11eq-v96:preflight
```

A pass must end with:

```text
DISDEX_V13D_V11EQ_V96_LIVE_PREFLIGHT_PASS_NO_ORDERS_SENT
```

Then start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now disdex-v13d-v11eq-v96.service
journalctl -u disdex-v13d-v11eq-v96.service -f
```

## Emergency stop

```bash
npm run strategy:disdex-v13d-v11eq-v96:kill-switch -- --activate --reason "operator emergency stop"
```

The Kill Switch is shared with Crypto V96. It remains latched. Do not delete or clear it until Aster and Hyperliquid orders, positions, runner state and audit logs have been reconciled manually.

## State and audit evidence

- Crypto V96 state: `.runtime-state/disdex-v13d-v11eq-v96/crypto-v96`
- Stock state: `.runtime-state/disdex-v13d-v11eq-v96/stock/stock-runner-{mode}.json`
- Stock audit: `.runtime-state/disdex-v13d-v11eq-v96/stock/stock-audit-{mode}.jsonl`
- Shared Kill Switch: `.runtime-state/disdex-v13d-v11eq-v96/kill-switch.json`

Unknown order state, incomplete hedge, reconciliation mismatch, stale data, daily loss trip or fatal Stock tick failure all fail closed.

## Validation commands

```bash
npm run strategy:disdex-v13d-v11eq-v96:contract
npm run strategy:disdex-v96:typecheck
npm run strategy:disdex-v96:selftest
npm run strategy:disdex-v96:frequency:selftest
```

No private key, API token, approval artifact or environment file containing secrets may be committed to GitHub.
