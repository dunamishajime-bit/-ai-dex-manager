# VPS runner-path reliability specification

## Objective

Keep the current V12, PENGU Dual LS V2, and Quality102 Causal V4 runners from silently skipping a decision cycle when a shared account lock or a transient read-only market-data request is unavailable. Make the runtime health record reflect the immutable release actually running so the HP and watchdog can distinguish a healthy no-signal cycle from a stale runner.

## Safety constraints

- No real, synthetic, test, or forced orders are allowed during this work.
- No automatic deletion of an expired account lock; an expired lock remains fail-closed and requires reconciliation.
- Never retry an order mutation. Only bounded read-only market-data retries are allowed.
- A missing current candle, stale quote, stale account, unknown position, or reconciliation mismatch remains blocked.
- Existing V12/PENGU/V52 strategy thresholds and ownership rules are unchanged.
- V52 remains intentionally stopped while its market/session and immutable release are not proven ready.

## Required behavior

1. PENGU and Quality102 retry a busy shared lock for a bounded window, then defer to the next normal boundary.
2. Q102 read-only market-data GETs use bounded backoff and a bounded per-symbol concurrency level. Missing current-hour data still fails closed.
3. V12, PENGU, and Q102 atomically publish non-secret heartbeat documents at startup and after every cycle result, including locked, blocked, and no-signal results.
4. Tests cover lock retry bounds, read-only retry behavior, provider concurrency, heartbeat atomicity/fields, and the existing strict contracts.
5. VPS rollout verifies the current immutable release, service dependencies, state reconciliation, heartbeat freshness, and zero order mutations before and after restart.
