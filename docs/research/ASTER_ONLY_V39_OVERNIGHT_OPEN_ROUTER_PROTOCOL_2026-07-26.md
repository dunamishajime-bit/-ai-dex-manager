# Aster-only V39 Overnight-Open Router Protocol

## Purpose

Test a materially different Aster-only fallback that does not use cash/perpetual Basis. It uses Aster's 24-hour stock-perpetual movement from the previous US close to 09:30 New York and the first cash-session hour through 10:30.

## Frozen candidates

72 candidates are declared before execution across:

- overnight continuation or opening reversal;
- minimum overnight move 50 / 100 / 150 bps;
- minimum first-hour confirmation 25 / 50 / 75 bps;
- overnight same-symbol rolling Z-score none or 1.5;
- one- or two-hour maximum holding.

The strongest of AMZN, META, MSFT, NVDA and TSLA is selected. Entry is at 10:30 New York. TP and SL are fixed at 1.00% with conservative same-candle ambiguity resolved as Stop first.

## Routing

- V11-EQ has first priority.
- When V11-EQ is absent or rejected, V39 may enter at 10:30.
- V19 remains available at 12:30 when the V39 position has already exited and the daily loss lock has not triggered.
- Maximum concurrent Gross is 1.0 and maximum concurrent positions is one.
- Hyperliquid is not used.

## Acceptance

At least four V39 Validation trades and eight total Validation trades are required. The router must exceed Normal +72.276908%, P95 +68.080022%, fallback Normal +7.813259% and fallback P95 +7.400908%, while passing Validation, Final, July, PF, DD, concentration and best-trade/month-removal audits.

## Limitations

The study uses Aster 30-minute OHLCV candles and historical Funding. Intrabar TP/SL order is not known; a candle touching both levels is scored as Stop first. Exact spread, depth, queue and post-only fills are not reconstructed.

## Safety

Research only. Production, LIVE, VPS, credentials, Crypto V96, V11-EQ, V19, V13D, orders and positions are unchanged.
