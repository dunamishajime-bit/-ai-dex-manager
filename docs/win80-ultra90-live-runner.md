# Win80 / Ultra90 Realtime Trading Runner

## Purpose

This runner turns `WIN80_ULTRA90_TOP1_V1` from a candidate-ranking policy into a server-side execution pipeline suitable for the XServer VPS.

It does not reuse the browser wallet loop in `SimulationContext.tsx`. The runner is an independent Node process with its own market-data adapter, account reader, order executor, state file and process lock.

## Pipeline

Each tick performs the following sequence.

1. Acquire an exclusive runner lock.
2. Resume or reconcile an unfinished transaction before evaluating a new signal.
3. Read Aster V3 `exchangeInfo` and keep only `TRADING` perpetual symbols.
4. Read current price, best bid/ask, 24-hour statistics and recent 1-hour candles.
5. Map Aster symbols such as `SUIUSDT` to the symbols used by `StrategyEngineInput`.
6. Read the actual USDT balance, open positions and open orders.
7. Build `StrategyEngineInput` and `ContinuousMonitorRuntimeState`.
8. Run `buildContinuousStrategyMonitor()` and use the selected Top-1 candidate.
9. Reclassify it through the final WIN80 / ULTRA90 gate.
10. Compare the candidate with the actual Aster positions.
11. Calculate the source sell and target buy quantities using current account/position notional.
12. Validate spread/slippage, `MARKET_LOT_SIZE`, `LOT_SIZE` and `MIN_NOTIONAL`.
13. Submit orders through `direct-trade-executor`.
14. Persist every phase atomically and reconcile uncertain order results by `clientOrderId`.

## Overlap policy

- No position: buy the Top-1 candidate with the configured account notional.
- Same symbol: hold; pyramiding is prohibited.
- Normal WIN80 while the existing largest position is profitable: sell 50% of that position and buy the new candidate with the confirmed sale proceeds.
- Normal WIN80 while the existing largest position is losing: reject the overlap.
- ULTRA90: sell 70% of the largest existing position regardless of PnL and buy the ULTRA90 candidate with the confirmed sale proceeds.
- Maximum concurrent positions: two.
- Existing short or negative positions cause a manual-review stop. This initial production runner is long-only.

## Transaction phases and failure recovery

The state file is `.runtime-state/win80-ultra90-runner.json` by default.

Rotation transactions use these phases:

- `planned`
- `source_sell_submitted`
- `source_sell_confirmed`
- `target_buy_submitted`
- `completed`
- `manual_review`

The source sell is persisted as submitted before the HTTP request is made. If the request times out or Aster returns HTTP 503, the runner treats execution as unknown and queries `/fapi/v3/order` by `origClientOrderId`.

It never blindly sends the same economic sell again. If the source sell is confirmed but the target buy fails, the next tick resumes from `source_sell_confirmed` and retries only the buy leg. After the configured retry limit the transaction changes to `manual_review`.

## Execution lock

`.runtime-state/win80-ultra90-runner.lock` is created with exclusive file semantics. A second process or overlapping timer cannot place another order. A stale lock can be removed after `WIN80_LOCK_STALE_MS`.

For a future multi-server deployment, replace the file lock and state store with a shared Redis implementation before running more than one VPS instance.

## Paper mode

Paper mode is the default and requires no Aster private key.

It uses live public Aster market data and the same strategy, quantity, filter, rotation and state pipeline, but fills orders into `.runtime-state/paper-portfolio.json`.

```bash
WIN80_RUNNER_MODE=paper npm run strategy:live:once
WIN80_RUNNER_MODE=paper npm run strategy:live:daemon
```

## Live mode safety gate

Live mode requires all of the following:

1. `WIN80_RUNNER_MODE=live`
2. `WIN80_LIVE_EXECUTION_ENABLED=true`
3. `MAIN_STRATEGY_REAL_TRADING_ENABLED=true` in `config/strategyConfig.ts`
4. Valid `ASTER_USER_ADDRESS`
5. Valid `ASTER_API_PRIVATE_KEY`

The repository currently keeps `MAIN_STRATEGY_REAL_TRADING_ENABLED=false`, so merging this runner does not activate real orders.

## Required Aster setup

Use an Aster V3 Pro API wallet. Store its private key only in the VPS environment file with restricted permissions. Do not put the key in GitHub, the service file, logs or the Next.js public environment.

The V3 client uses EIP-712 with:

- Domain name: `AsterSignTransaction`
- Version: `1`
- Chain ID: `1666`
- Zero verifying contract
- Microsecond nonce
- `user`, `signer`, `nonce` and `signature`

## VPS process

Copy `deploy/win80-ultra90-live-runner.service.example`, update paths and install it as a systemd service only after Paper validation.

Recommended sequence:

```bash
npm ci
npm run strategy:live:selftest
npm run strategy:live:typecheck
WIN80_RUNNER_MODE=paper npm run strategy:live:once
WIN80_RUNNER_MODE=paper npm run strategy:live:daemon
```

Review the paper state, candidate frequency, realized costs and restart recovery before considering the separate live-enablement change.

## Remaining production improvements

The runner polls public REST data on each tick and reconciles account/order state with signed REST endpoints. Aster recommends WebSocket streams for the most timely market and user data. Before unrestricted live scaling, add:

- public book-ticker/kline WebSocket cache;
- user-data `ACCOUNT_UPDATE` and `ORDER_TRADE_UPDATE` reconciliation;
- shared Redis lock/state if more than one process is used;
- alert delivery for `manual_review`;
- VPS deployment smoke test against a dedicated small-balance account.
