# Aster-only V49 Standalone Residual Engine Protocol

## Objective

Find one AsterDEX-only strategy whose own trailing-365-day return clears the hurdle without adding V11-EQ, V19, V48, V96 or any other strategy return.

## Fixed economic thesis

Cross-sectional idiosyncratic residual momentum across the five long-history Aster stock perpetuals. At 10:30, 12:30 and 15:00 New York time, remove the five-symbol median move and trade the strongest remaining stock-specific continuation or predeclared residual-reversal regime.

## Architecture

- AsterDEX only;
- AMZN, META, MSFT, NVDA, TSLA;
- maximum concurrent Gross 1.0;
- maximum one position at a time;
- maximum one-hour holding per window;
- maximum three sequential trades per day;
- same-symbol consecutive window use blocked;
- daily net loss stop at -2%;
- Hyperliquid not used.

## Frozen tournament

216 candidates from predeclared continuation, reversal and regime-switch families. Thresholds, directions and broad-regime levels are frozen before execution. Development selects the top 40; chronological Validation selects at most one. Final and July Holdout are not used to select.

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

Research only. Production, LIVE, VPS, credentials, orders and positions remain unchanged.
