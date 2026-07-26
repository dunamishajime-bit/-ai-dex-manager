# Aster-only V47 Three-Window Router Protocol

## Purpose

Combine three non-overlapping Aster-only opportunities while preserving V11-EQ priority and the V19 baseline:

1. high-confidence residual continuation at 10:30;
2. smaller Opening Reversal when the core is absent;
3. a late Closing Overlay after all earlier positions have exited.

## Frozen core

The residual core is fixed as:

`R100__ONMAX100__OPENMAX10000__LONG_ONLY__REL_ANY__DOM1`

It uses Gross 1.0 and exits by 11:30.

## Frozen candidate grid

216 candidates are declared before execution across:

- Opening Reversal confirmation 25 or 75 bps;
- reversal holding one or two hours;
- reversal Gross 0.10 / 0.25 / 0.50;
- reversal both directions, Long only or Short only;
- Closing Overlay disabled, Morning Range Break Long, or Cross-Residual Long;
- same-symbol reuse allowed or blocked.

The reversal retains the 150 bps Overnight threshold and Z-score 1.5. The closing candidates are fixed versions previously evaluated in V46.

## Routing

- V11-EQ has first priority.
- Without V11-EQ, the 10:30 residual core is used when available; otherwise the fractional Opening Reversal may be used.
- V19 remains available at 12:30 after the open trade exits.
- The selected closing candidate may enter only after every previous position has exited.
- The daily loss lock remains -2%.
- Maximum concurrent Gross is 1.0 and maximum concurrent positions is one.
- Hyperliquid is not used.

## Acceptance

At least four auxiliary-family Validation trades and eight total Validation trades are required. The router must exceed Normal +72.276908%, P95 +68.080022%, fallback Normal +7.813259% and fallback P95 +7.400908%, while passing Validation, Final reused, July Holdout, PF, DD, concentration and robustness checks.

## Safety

Research only. Production, LIVE, VPS, credentials, Crypto V96, V11-EQ, V19, V13D, orders and positions are unchanged.
