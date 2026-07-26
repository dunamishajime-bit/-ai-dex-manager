# Aster-only V37 Absolute Basis Idle Overlay Protocol

## Goal

Preserve the V11-EQ plus V19 baseline and add one later Absolute Basis convergence trade only on sessions where the baseline is idle or has already exited.

## Frozen candidate grid

162 candidates are declared before execution:

- entry: 11:30, 12:30 or 13:30 New York;
- minimum absolute Basis: 50, 75 or 100 bps;
- minimum same-slot rolling Z-score: none, 1.5 or 2.0;
- maximum holding: one or two hours;
- both directions, premium-only or discount-only.

The absolute Top-1 Basis symbol is evaluated. The strategy shorts an Aster premium and buys an Aster discount. It exits on convergence to 15 bps, a Basis sign change, a 1.5x adverse Basis stop or the fixed time limit.

## Routing

- Original V11-EQ and V19 routing is preserved.
- An overlay is rejected when it overlaps a baseline position.
- A baseline event with a daily loss of -2% or worse blocks the overlay.
- At most one overlay can be added per day.
- Maximum concurrent Gross remains 1.0 and only one position can be open.
- Hyperliquid is not used.

## Acceptance

The candidate must exceed router Normal +72.276908%, P95 +68.080022%, fallback Normal +7.813259% and fallback P95 +7.400908%. It must also produce at least four candidate-specific Validation overlays, at least eight total Validation trades, positive Validation/Final/July Normal and P95, PF and DD controls, concentration at or below 40%, and positive best-trade/month-removal audits.

## Discipline and safety

Development sends at most 40 candidates to Validation. Final reused and July Holdout cannot select or retune. Research only; Production, LIVE, VPS, credentials, Crypto V96, V11-EQ, V19, V13D, orders and positions are unchanged.
