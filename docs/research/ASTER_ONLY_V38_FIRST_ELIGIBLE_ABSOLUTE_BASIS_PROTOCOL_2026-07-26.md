# Aster-only V38 First-Eligible Absolute Basis Protocol

## Purpose

Test whether the fixed V37 Absolute Basis conditions become chronologically reliable when evaluated causally at 11:30, 12:30 and 13:30 New York, entering only the first eligible signal.

## Frozen grid

54 candidates reuse the V37 thresholds without adding new values:

- minimum absolute Basis 50 / 75 / 100 bps;
- same-slot rolling Z-score none / 1.5 / 2.0;
- one- or two-hour maximum holding;
- both directions, premium-only or discount-only.

## Causality and routing

- Slots are checked in chronological order: 11:30, then 12:30, then 13:30.
- Future slots are never compared to choose an earlier entry.
- At most one overlay is generated per session.
- Original V11-EQ and V19 routing is preserved.
- The overlay is allowed only when the baseline is idle or has already exited.
- Maximum concurrent Gross remains 1.0 and Hyperliquid is not used.

## Acceptance

The V37 hurdle remains unchanged: at least four candidate-specific Validation overlays, eight total Validation trades, router Normal above +72.276908%, router P95 above +68.080022%, fallback Normal above +7.813259%, fallback P95 above +7.400908%, and all PF, DD, concentration, Final, July and robustness requirements.

## Safety

Research only. Production, LIVE, VPS, credentials, Crypto V96, V11-EQ, V19, V13D, orders and positions are unchanged.
