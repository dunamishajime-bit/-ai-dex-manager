# V96 Crypto + V11 + V13D One-Year Portfolio Backtest Protocol — 2026-07-25

## Purpose

Freeze the current Production Crypto V96 logic together with the two selected Stock strategies, V11 and V13D, and reconstruct one complete production-style portfolio year before any combined Production implementation.

This is a portfolio-routing test. It does not retune the internal signal, threshold, direction, exit, symbol or cost rules of Crypto V96, V11 or V13D.

## Fixed period

- Start inclusive: 2025-07-01 00:00 UTC
- End exclusive: 2026-07-01 00:00 UTC
- Calendar length: exactly 365 days
- Stock universe: AMZN, META, MSFT, NVDA and TSLA
- Missing or pre-launch XYZ history is not synthesized

## Frozen source commits

- Crypto V96 research base: `17d2acd512dac75f6c9b7c427cb4995b6ab8c81b`
- V11: `0fad24c105a7f0f61af6042ba04a8b1386ffec7c`
- V13D: `dbfd7e026a81343a23ab97d202761f7f9bbe5755`

The CI checks out V11 and V13D by exact SHA. Later research changes cannot alter this test.

## Frozen strategies

### Crypto V96

The signal and risk engine remains the current Production revision:

- Core component volume floor 0.50;
- portfolio rebalance threshold 7.5%;
- Weight Band tolerance 5%;
- forced refresh 12 completed 12-hour bars;
- Bear confirmation 4 bars;
- existing Strong Boost, Drawdown Stage and Whipsaw controls;
- reserved PENGU target Gross 1.15;
- minimum active PENGU clip 50%;
- Production V96 internal total Gross cap 2.0 before portfolio-sleeve adaptation.

For the unified portfolio only, the complete Crypto V96 target is proportionally scaled to a dedicated Crypto sleeve maximum Gross of 1.0. The relative Core/PENGU composition is not reselected.

### V11

Candidate: `BOTH__FLAT__CONVERGENCE__ABS_TOP1`

- Cash/Aster absolute Basis at least 50 bps;
- both premium-Short and discount-Long directions;
- absolute-Basis Top1;
- flat Stock Gross 1.0;
- signal alignment around 10:00 New York;
- entry at 10:30 New York;
- exit when absolute Basis is at most 15 bps;
- exit on zero-cross;
- stop when absolute Basis expands to 1.5 times entry Basis;
- otherwise exit at 15:30 New York;
- actual public Aster Funding included;
- no overnight position.

### V13D

Candidate: `EDGE20__NO_PREVIOUS_SYMBOL`

- Aster Maker and opposite XYZ Taker hedge;
- absolute Aster/XYZ dislocation at least 20 bps;
- entry at 10:00 New York;
- largest simultaneous eligible dislocation;
- skip the immediately preceding completed V13D symbol once;
- one Stock position total;
- strict historical Maker-fill proxy: next 30-minute Aster open must cross the prior completed-bar Maker quote;
- at the completed 14:00 bar, price PnL at least 30 bps exits at 14:30;
- otherwise exit at 15:00;
- actual Aster and XYZ Funding included;
- no overnight position.

No 18/22/25 bps floor, nearby entry time, additional take-profit, different holding time or symbol blacklist is permitted.

## Portfolio allocation

- Crypto sleeve Gross cap: 1.0
- Stock sleeve Gross cap: 1.0
- Total portfolio Gross cap: 2.0
- Sleeve lending: disabled
- Unused Stock capacity remains cash outside Stock trading hours
- Stock activity never suppresses a valid Crypto signal inside the independent Crypto sleeve
- Existing positions are not preempted to admit a later signal

## Time router — New York time

| Time | Active logic |
| --- | --- |
| 00:00–09:29 | Crypto V96 only; Stock sleeve remains cash |
| 09:30–09:59 | Crypto continues; completed Stock signals are collected |
| 10:00 | V13D is evaluated first |
| 10:30 | V11 is evaluated only if V13D did not open |
| 11:30–15:30 | The selected Stock position follows its own frozen exit; Crypto continues |
| After 15:30 | Crypto V96 only; Stock sleeve returns to cash |

## Order-conflict rules

### V13D versus V11

V13D has causal first priority because its entry occurs at 10:00.

- If V13D obtains a completed strict historical fill proxy, it occupies the only Stock sleeve and V11 is skipped at 10:30.
- If V13D has no eligible completed fill proxy, V11 may enter at 10:30.
- V11 never replaces, nets or reverses an existing V13D position.
- Same-symbol opposite Stock positions are impossible because only one Stock position is allowed.

### Stock versus Crypto

- The sleeves are independent.
- A Stock order cannot cancel a Crypto order.
- A Crypto order cannot cancel a Stock order.
- Each sleeve is capped at Gross 1.0.
- Combined Gross cannot exceed 2.0.
- No unused-capacity transfer is permitted.

## Daily loss and Kill Switch proxy

The combined portfolio uses the existing maximum daily equity loss policy of 2%.

Historical resolution is limited to completed Crypto 12-hour return buckets and completed Stock trades:

- the completed event that causes cumulative UTC-day return to reach -2% or worse is retained in full;
- no loss is truncated at exactly -2%;
- all later entries and return events in that UTC day are blocked;
- eligibility resets at the next UTC day;
- exact intrabar emergency-flatten timing and Slippage cannot be reconstructed.

This convention is deliberately conservative relative to clipping the loss at exactly -2%.

## Cost scenarios

### Forward-median Stock / Crypto Normal

- Crypto: Production V96 Normal historical rows
- V11: 12 bps per one-way turnover
- V13D: 10 bps complete cycle

### Normal

- Crypto: Production V96 Normal historical rows
- V11: 20 bps per one-way turnover
- V13D: 16 bps complete cycle

### Stock P95 / Crypto Normal

- Crypto: Production V96 Normal historical rows
- V11: 22 bps per one-way turnover
- V13D: 26 bps complete cycle

### Severe

- Crypto: Production V96 Severe historical rows
- V11: 50 bps per one-way turnover
- V13D: 45 bps complete cycle

## Required comparisons

The same run reports:

- unified Crypto + V11/V13D router;
- Crypto sleeve Gross 1.0 alone;
- Crypto + V11 only;
- Crypto + V13D only;
- V11 standalone;
- V13D standalone;
- routed Stock sleeve standalone.

This identifies whether the combined result comes from genuine diversification or simply from the Crypto sleeve.

## Interpretation boundary

- V11 and V13D were chosen from previously inspected history; this is not an independent Holdout.
- V13D historical candles cannot prove queue consumption, exact bid/ask, partial-fill safety or the 250 ms hedge.
- The Crypto V96 reconstruction includes the known fixed PENGU historical trade sequence.
- A positive result can freeze a combined Production candidate but cannot by itself authorize LIVE activation.
- Untouched Forward execution evidence remains mandatory for V13D and combined routing.

## Safety

- Research only
- Order submission disabled
- Production unchanged
- LIVE unchanged
- VPS unchanged
- Existing real positions unchanged
