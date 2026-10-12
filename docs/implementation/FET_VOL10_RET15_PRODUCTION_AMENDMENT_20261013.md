# FET BRK48 VOL10_RET15 Production Amendment

Date: 2026-10-13

## Scope

This amendment changes only new-entry admission for `FET_BRK48_RESIDUAL` / `FETUSDT`.

The existing FET contract remains unchanged for:

- LONG direction and BRK48 breakout source;
- completed-H1 causal boundary and UTC decision window;
- minimum volume and minimum 72h return;
- Gross `1.0x`, 5x Cross, shared risk, account lock, and quantity gates;
- resident `STOP_MARKET`, profit-floor replacement, 24-hour hold, and 24-hour cooldown;
- order idempotency, pending reconciliation, unknown execution handling, and fail-closed behavior.

## New entry gate

After the existing minimum gates, a new FET entry is eligible only when both conditions hold:

```text
volumeRatio <= 10.0
completedCloseToCompletedCloseReturn72h <= 15.0%
```

The boundaries are inclusive. Values above either bound are rejected before order planning. No existing position is modified by this gate; it applies only to new entries.

## Evidence and limitation

The research comparison was an Aster H1 causal price-model replay. The available FET history began on 2026-01-09 and did not provide a complete requested one-year Aster history. Funding was not included because the public kline replay did not contain funding cashflows. This amendment therefore records the selected filter as an operational entry guard, not as historical L2 fill-parity proof.

## Safety

No test or deployment order is permitted. Existing positions and resident protection remain under the current reconciliation path. If the exact release SHA is not authorized by the existing operator artifact, the FET service must remain fail-closed.
