# Aster-only V26 Non-Basis Result and V27 Direction

## V26 result

Status: `ASTER_ONLY_V26_NO_VALIDATED_NONBASIS_FALLBACK`

The tournament tested 150 predeclared candidates across six materially different economic families:

- cash lead / Aster lag continuation;
- cash and Aster directional disagreement;
- five-stock cash breadth with Aster lag;
- cross-sectional cash momentum;
- overnight gap continuation;
- overnight gap reversal.

All candidates were AsterDEX-only, Gross 1.0 maximum, one or two hour holding, and routed only after V11-EQ was not accepted.

- Development survivors: 150;
- Validation survivors: 0;
- CI backtest: success;
- CI safety validation: success.

The strongest Validation sample was the 13:30 New York Breadth-Lag family:

`BREADTH_LAG__B25__L15__S3__H2`

- Validation Normal: +1.682822%;
- Validation P95: +1.795432%;
- Validation Normal trades: 6;
- Validation PF: 6.237015;
- Validation DD: -0.309456%.

The higher-threshold Breadth-Lag candidate produced:

`BREADTH_LAG__B60__L15__S3__H2`

- Validation Normal: +1.998463%;
- Validation P95: +1.795432%;
- Validation Normal trades: 5;
- Validation PF: 188.929028;
- Validation DD: -0.010565%.

Both failed the frozen minimum of eight Validation trades. Cash/Aster disagreement and cross-sectional momentum candidates generally produced only two accepted Validation trades.

Evidence:

- workflow run: `30175452888`;
- artifact: `8624076185`;
- artifact SHA-256: `86c6e7a5d6e874887050f1aad050f65f5ff2398f4a036fbc0e042558cde8e163`.

## Interpretation

The non-Basis hypotheses were not disproved, but the five-stock one-year history did not provide enough chronological Validation observations. Further threshold searching on the same features would optimize against already observed data.

## Next materially different research directions

### 1. QQQ beta-residual momentum — highest priority

Estimate each stock's rolling beta to QQQ from prior sessions. During the cash session calculate:

`idiosyncratic residual = stock cash return - rolling beta * QQQ return`

Trade the Aster stock perpetual in the residual direction only when:

- the residual exceeds a frozen volatility-normalized threshold;
- Aster has not already fully followed the cash residual;
- QQQ regime, breadth and cost gates are valid;
- V11-EQ has not used the Stock sleeve.

This is not Basis convergence. The expected profit source is continuation of stock-specific information after removing the broad Nasdaq move.

### 2. Earnings-event post-announcement drift

Use frozen historical earnings dates and surprise direction. Enter Aster only when the overnight gap and first-hour cash move confirm the earnings surprise. Exit intraday or at a fixed short horizon. This adds a genuinely new event information set and should not trade on ordinary days.

### 3. Funding squeeze continuation

When Aster Funding shows crowded positioning but the underlying cash stock breaks strongly against that crowd, trade in the cash breakout direction. Examples:

- positive Funding plus strong cash upside breakout: Aster Long squeeze;
- negative Funding plus strong cash downside breakdown: Aster Short squeeze.

This differs from prior Funding-supported fade because it trades crowd unwind continuation rather than mean reversion.

### 4. Opening-range volatility expansion

Use the first completed cash-session range, cash volume expansion, Aster confirmation and QQQ regime. Trade only confirmed range breaks, not price-to-reference convergence.

## Recommended V27 scope

The next tournament should combine QQQ beta-residual momentum and Funding squeeze continuation, because both can be reconstructed historically without inventing pre-listing Aster data. Earnings-event drift should be a separate frozen event study once a trustworthy historical earnings dataset is fixed.

Safety remains research-only. Production, LIVE, VPS, Crypto V96, V11-EQ, V19, V13D, credentials, orders and positions are unchanged.
