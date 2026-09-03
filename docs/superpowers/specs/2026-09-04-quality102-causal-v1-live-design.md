# Quality102 Causal V1 LIVE Design

## Decision

Implement `QUALITY102_CAUSAL_V1` as a new production strategy sleeve. It is not presented as a parity restoration of the historical Quality102 selector used by GitHub Actions Run `33404708902`.

The historical selector remains unproven in two places: the HIGH_VOL 525-to-30 selection rule and the upstream BRK `strength` formula. This design does not infer either rule, replay frozen historical timestamps, or claim `QUALITY102_LIVE_SELECTOR_PARITY=true`.

## Scope

The new sleeve uses only causal behavior that can be implemented from repository evidence:

- HIGH_VOL candidates generated from decision-time or earlier OHLCV and the documented walk-forward process.
- PB, MR, and REV candidates generated from their recovered causal conditions.
- BRK disabled until its upstream `strength` calculation is recovered and independently validated.
- One managed Quality102 position at a time.
- Maximum Quality102 Gross of `0.50x`.
- Maximum combined crypto Gross of `2.00x`.
- Maximum total portfolio Gross of `2.50x`.

V12, PENGU V8, and V52 retain their current signal, ownership, sizing, and service behavior.

## Identity and Compatibility

The production strategy identity is `QUALITY102_CAUSAL_V1`. Historical `QUALITY102` research rows remain research evidence and are never converted into LIVE intents.

Runtime status must expose both facts:

- `QUALITY102_CAUSAL_V1_LIVE=true` only after all deployment gates pass.
- `QUALITY102_HISTORICAL_SELECTOR_PARITY=false` until the missing original formulas are recovered.

This prevents a fresh causal implementation from being mistaken for the historical 102-event strategy.

## Data Flow

1. Read the configured crypto universe and closed market candles.
2. Reject missing, stale, non-contiguous, non-finite, or future-dated data.
3. Generate HIGH_VOL, PB, MR, and REV candidates using only data available at the decision timestamp.
4. Apply causal quality gates and deterministic ordering.
5. Enforce one-slot ownership and suppress candidates when a sleeve position or unresolved order already exists.
6. Produce an intent with a deterministic idempotency key. Signal generation never calls an exchange.
7. Reconcile account positions, open orders, pending local state, and strategy ownership.
8. Pass the intent to the shared strict portfolio planner.
9. Calculate current positions plus planned orders before submission.
10. Submit only the quantity accepted by all gates.

## Priority and Gross Control

V12, PENGU V8, and V52 are base strategies. `QUALITY102_CAUSAL_V1` is always lowest priority.

For a new Quality102 entry, requested Gross is:

`min(0.50, crypto residual, total residual)`

If the result is zero or below the exchange minimum, no order is submitted.

When a base-strategy entry would cause a cap conflict, the base entry remains eligible and only the Quality102 position may be reduced. The reduction is planned before the base order is sent. It uses the verified current LIVE mark, realizes Long or Short PnL and actual configured transaction costs once, preserves the remaining cost basis, persists the new quantity, and recalculates Gross. Zero-PnL quantity deletion is prohibited.

The final pre-submit state must satisfy:

- Quality102 Gross `<= 0.50x`
- Crypto Gross `<= 2.00x`
- Total Gross `<= 2.50x`
- Existing V12, PENGU, and V52 caps

## Runtime State

Quality102 has an independent state file with:

- schema version and runtime commit SHA
- managed position identity and cost basis
- pending order phase and exchange/client order IDs
- last processed closed-candle timestamp
- deterministic signal/idempotency key
- last successful reconciliation timestamp
- last mark and its timestamp/source
- kill-switch and daily-loss-latch status

State updates use the existing atomic-write pattern. A restart reconciles pending and exchange state before evaluating another signal. An unknown or ambiguous order result requires manual review and blocks new Quality102 orders without blocking V12, PENGU, or V52.

## Safety Gates

Quality102 fails closed when any required input is missing, stale, future-dated, inconsistent, or unowned. Required gates include:

- explicit production and strategy LIVE flags
- independent Quality102 operator arm
- service/runtime commit SHA match
- kill switch clear
- daily loss latch clear
- fresh, closed market data
- fresh account equity and marks
- successful position and open-order reconciliation
- no unresolved Quality102 pending order
- deterministic symbol mapping and strategy ownership
- one-slot compliance
- Gross planner acceptance
- exchange quantity and minimum-notional validation
- shared account order lock

A Quality102-only failure is recorded and blocks only the Quality102 sleeve. Shared account uncertainty, reconciliation failure, or Gross uncertainty blocks all new orders through the existing global gate.

## Deployment and Activation

Deployment is staged:

1. Run unit, integration, type, build, and regression tests.
2. Push the implementation branch and require GREEN CI at the exact SHA.
3. Deploy an immutable release to the XServer VPS.
4. Install or update the Quality102 service in no-write mode without changing existing positions or orders.
5. Verify single-runner ownership, state paths, disk capacity, market data, account reconciliation, Gross values, logs, and zero submitted test/synthetic orders.
6. Enable the independent Quality102 arm and restart only the Quality102 service.
7. Confirm the service is active, the exact release SHA is loaded, reconciliation remains healthy, and no duplicate/pending order exists.

No synthetic or test LIVE order is used. Activation does not force an entry; the first real order can occur only from a naturally generated post-activation signal.

## Tests

Tests are written before production changes and must cover:

- causal data cutoff and rejection of future/stale/incomplete candles
- HIGH_VOL, PB, MR, and REV positive and negative cases
- BRK remains disabled
- deterministic selection and idempotency
- one-slot enforcement
- Quality102 `0.49x`, `0.50x`, and `0.51x` boundaries
- Crypto `1.99x`, `2.00x`, and `2.01x` boundaries
- Total `2.49x`, `2.50x`, and `2.51x` boundaries
- simultaneous V12, PENGU, V52, and Quality102 intents
- Quality102-only MTM reductions for profitable and losing Long and Short positions
- actual fee accounting exactly once
- restart and pending-order reconciliation
- duplicate-order prevention
- Quality102-local failure does not stop the three base strategies
- global uncertainty blocks all submissions
- existing V12, PENGU V8, and V52 regression suites remain unchanged

## Acceptance Criteria

Implementation is complete only when:

- `QUALITY102_CAUSAL_V1` produces signals solely from decision-time or earlier data.
- BRK cannot produce a LIVE signal.
- All Gross and priority rules pass automated tests.
- Restart and reconciliation tests pass.
- Existing strategy regression tests pass.
- CI is GREEN at the deployed SHA.
- VPS no-write preflight and reconciliation pass before activation.
- Existing positions and orders are not force-modified during deployment.
- Test and synthetic LIVE orders equal zero.
- The final report keeps historical selector parity explicitly false.

