# Aster-only V50 Standalone Post-Open Basis Engine Protocol

## Objective

Find a second AsterDEX-only stock-perpetual engine that earns at least +50% Normal over the exact trailing 365 days **without including V11-EQ, V19, V48, V96 or any other strategy return**.

## Economic thesis

V11-EQ demonstrated that synchronized U.S. cash-equity versus Aster perpetual Basis can converge intraday. V50 tests the same economic mechanism after the V11 10:30 window has passed. It trades only fresh post-open Basis dislocations observed at 11:30, 12:30, 13:30 or 14:30 New York time.

## Independence from V11

- No 10:30 V11 trade is included.
- No V11 return is included in any metric.
- No portfolio/router return is presented as V50 return.
- V50 is evaluated as a standalone account-equity stream.

## Fixed architecture

- Venue: AsterDEX only.
- Universe: AMZN, META, MSFT, NVDA, TSLA.
- Same-time U.S. cash reference used only for signal and execution gating.
- Select the largest absolute eligible entry Basis among the five symbols.
- Aster premium: Short Aster.
- Aster discount: Long Aster.
- Exit when Basis reaches 15 bps, crosses zero, reaches 1.5 times entry Basis, or the maximum holding time expires.
- Maximum concurrent Gross 1.0.
- Maximum one position at a time.
- Maximum three sequential trades per day.
- Daily loss stop at -2%.
- Hyperliquid not used.

## Frozen tournament

162 candidates:

- window sets: all four post-open windows, early three, or late three;
- minimum entry Basis: 50, 75 or 100 bps;
- maximum holding: 1, 2 or 3 hours;
- direction: both, premium-short only or discount-long only;
- same-symbol cooldown: on or off.

Development selects the top 40. Chronological Validation selects at most one. Final and July Holdout are not used to select.

## Required final hurdles

- standalone Normal >= +50%;
- standalone P95 >= +30%;
- Normal PF >= 1.5;
- Normal maximum DD no worse than -15%;
- at least 50 Normal trades;
- Validation at least 8 trades, PF >= 1.2 and Normal/P95 positive;
- Final Normal/P95 positive;
- July Holdout at least 3 trades and Normal/P95 positive;
- largest positive-profit symbol share <= 40%;
- best trade and best month removed remain positive;
- Severe 100 bps fails closed/nonnegative.

## Safety

Research only. Production, LIVE, VPS, credentials, orders, V96, V11-EQ, V19 and V48 remain unchanged.
