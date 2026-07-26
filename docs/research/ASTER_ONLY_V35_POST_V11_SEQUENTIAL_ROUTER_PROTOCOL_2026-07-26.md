# Aster-only V35 Post-V11 Sequential Router Protocol

## Hypothesis

The earlier V29 router blocked every fallback for the entire market session whenever V11-EQ entered, even when V11-EQ had already exited before a later signal. V35 releases the Stock sleeve at the actual V11-EQ exit timestamp and permits a later Aster-only entry only when there is no overlap.

## Frozen components

No signal parameters are retuned. V35 reuses the 18 frozen V29 policies built from:

- 11:30 Z-score micro fade;
- 11:30 basis-acceleration micro fade;
- 12:30 V19;
- 12:30 Opening Range and volume;
- 13:30 Breadth lag.

## Routing

- V11-EQ always has first priority.
- V11-EQ can be followed by another signal only after its recorded exit time.
- Only one position can be open at once.
- Total Gross remains 1.0.
- Daily loss lock remains -2%.
- Hyperliquid is not used.

## Acceptance

The frozen V29/V22 requirements remain unchanged. A candidate must exceed router Normal +72.276908%, P95 +68.080022%, fallback Normal +7.813259% and fallback P95 +7.400908%, while passing Validation, Final reused, July Holdout, PF, DD, concentration and best-trade/month-removal checks.

## Discipline and safety

Development and Validation can select at most one of the 18 frozen policies. Final reused and July Holdout cannot select or retune. Research only; Production, LIVE, VPS, credentials, Crypto V96, V11-EQ, V19, V13D, orders and positions are unchanged.
