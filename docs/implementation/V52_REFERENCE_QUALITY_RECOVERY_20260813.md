# V52 Reference Quality Recovery Handoff — 2026-08-13

## Purpose

Restore V52 Stock LIVE eligibility after `BLOCKED_DATA_UNAVAILABLE` caused by the Pyth + Alpaca IEX reference-quality gate, without bypassing Fail Closed safety and without changing V52 trading logic, V96/PENGU behavior, account state, positions, or order logic.

## Observed production state before this handoff

The inspected LIVE deployment reported:

- service: active/running
- deployed commit: `621bdc692cbbed9de5932523e29b0029e3959aff`
- restart count: 0
- V96/PENGU runner: running
- Kill Switch: `active=false`
- managed positions: 0
- open orders: 0
- V52: `BLOCKED_DATA_UNAVAILABLE`
- `V52_ORDERS=0`
- `ordersAllowed=false`
- `workerStarted=false`

The stock reference service itself was healthy and both Pyth and IEX were connected. Per-symbol quality checks were rejecting data for reasons including:

- AMZN: `cross_source_divergence`
- META: `iex_quote_stale`
- MSFT/NVDA: Pyth age above the configured freshness ceiling
- TSLA: `pyth_confidence_too_wide`

The actual preflight stop was `RuntimeError: Reference quote stale for AMZN`.

This is a quality-gate rejection, not a market-hours failure and not a reference-service connection outage.

## Current policy at the deployed commit

`ops/env/disdex-v13d-v11eq-v96.env.example` currently documents:

```dotenv
DISDEX_PYTH_MAX_AGE_MS=1200
DISDEX_IEX_MAX_AGE_MS=1500
DISDEX_PYTH_MAX_CONFIDENCE_BPS=10
DISDEX_REFERENCE_MAX_CROSS_SOURCE_BPS=20
```

`scripts/disdex_stock_reference_pyth_iex_proxy.py` fails closed when any of these limits is exceeded.

The 1.2s/1.5s freshness ceilings are too tight for a validator whose source quote may legitimately remain unchanged for several seconds. A connected source can therefore be rejected repeatedly even though it is functioning normally.

## Required production policy change

Use the following conservative V52 stock-reference quality limits:

```dotenv
DISDEX_PYTH_MAX_AGE_MS=5000
DISDEX_IEX_MAX_AGE_MS=5000
DISDEX_PYTH_MAX_CONFIDENCE_BPS=25
DISDEX_REFERENCE_MAX_CROSS_SOURCE_BPS=50
```

These are ceilings, not bypasses. Fail Closed must remain active:

- Pyth age > 5000 ms => reject
- IEX age > 5000 ms => reject
- Pyth confidence > 25 bps => reject
- absolute Pyth/IEX divergence > 50 bps => reject
- missing Pyth or IEX quote => reject
- disconnected/degraded reference source => reject

Do not introduce IEX-only fallback, stale-price fallback, cached-price substitution, or unconditional acceptance.

## Repository changes Codex should make

1. Update the canonical example/runtime documentation so the four values above are the documented V52 production policy.
2. Update any immutable LIVE policy/config source that explicitly freezes the old 1200/1500/10/20 values, but only where required for V52 reference validation.
3. Add or update self-tests proving the new limits and proving values outside the new limits still Fail Closed.
4. Do not alter signal generation, entry/exit logic, position sizing, margin policy, V96, PENGU, or order submission semantics.
5. Produce a new immutable Git SHA for deployment. Do not edit the existing deployed release in place.

## VPS deployment scope

After creating and reviewing the new SHA, deploy that exact immutable release through the existing formal deployment path. On the VPS, change only the four V52 stock-reference quality values if the root-owned production EnvironmentFile overrides repository defaults.

Do not print secrets or the EnvironmentFile contents. Do not change API keys, wallet/private keys, account identifiers, trading acknowledgements, Kill Switch state, or unrelated environment variables.

Restart only the minimum service(s) required for the reference-policy change and normal V52 supervisor activation. Do not restart V96/PENGU unless the existing formal combined-service architecture makes that unavoidable; if unavoidable, verify their state before and after and stop on any discrepancy.

## Mandatory verification before declaring recovery

No manual order may be sent as a test.

Verify in this order:

1. exact deployed SHA equals the newly approved SHA;
2. `disdex-stock-reference-free.service` is active/running;
3. `/health` is `ok`, `pythConnected=true`, `iexConnected=true`;
4. during U.S. regular session, request validated quotes for AMZN, META, MSFT, NVDA, TSLA;
5. all five quotes pass the new quality policy at the moment of verification;
6. run the existing self-test;
7. run the formal no-order Preflight;
8. confirm V52 is no longer `BLOCKED_DATA_UNAVAILABLE`;
9. confirm `workerStarted=true` and `ordersAllowed=true` only if every normal LIVE gate independently passes;
10. confirm Kill Switch remains `active=false`;
11. confirm V96/PENGU remains healthy and unchanged;
12. confirm managed positions and open orders are unchanged by the deployment itself.

If any mandatory gate fails, leave V52 Fail Closed. Do not weaken another gate to force `ordersAllowed=true`.

## Explicitly prohibited

- no V52 strategy-condition changes
- no V96/PENGU strategy changes
- no order placement for testing
- no manual position changes
- no Kill Switch bypass
- no reference validation bypass
- no IEX-only or Pyth-only fallback
- no `.env` broad rewrite
- no secret output
- no direct editing of an immutable deployed release
- no unrelated cleanup/refactor

## Success criterion

Recovery is successful only when the formal self-test and no-order Preflight pass with real current Pyth + IEX validation under the new 5000/5000/25/50 policy, while all other production safety gates remain intact. `ordersAllowed=true` must be the consequence of the normal gates passing, never a forced setting.
