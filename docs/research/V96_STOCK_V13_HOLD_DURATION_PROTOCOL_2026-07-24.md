# V96 Stock V13 Longer-Hold Historical Protocol — 2026-07-24

## Hypothesis

The frozen V13 60-second inventory limit may be too short for Aster/XYZ spread convergence. The prior 15-minute diagnostic produced a positive gross Aster-Maker effect before costs, so holding duration is tested directly without changing the entry threshold, symbols, direction or cost envelopes.

## Fixed candidate set

- data interval: synchronized 30-minute Aster and XYZ candles;
- fixed data end: 2026-07-24 00:00 UTC;
- universe: AMZN, META, MSFT, NVDA, TSLA;
- Maker venue: Aster or XYZ;
- hold durations: 30, 60, 120, 180, 240 and 300 minutes;
- candidate count: 12;
- opening dislocation: absolute Aster/XYZ spread at least 12 bps;
- direction: sell the premium venue and buy the discount venue;
- virtual initial Maker notional: 100 USD;
- one active cycle per symbol;
- no overnight positions;
- minimum Maker-bar volume-capacity proxy: 350 USD;
- strict fill proxy: next 30-minute bar open must already be at or through the prior completed-bar Maker quote.

No nearby spread threshold, symbol-specific rule, direction filter or cost assumption may be selected from the result.

## Funding and costs

Actual public Funding histories from Aster and XYZ are included for each hold interval. Funding PnL is approximated relative to the fixed 100 USD initial notional.

Primary scoring uses the frozen forced-Taker complete-cycle costs:

- Forward median: 10 bps;
- Normal: 16 bps;
- P95: 26 bps;
- Severe: 45 bps.

The lower two-Maker envelope of 6 / 10 / 17 / 30 bps is reported only as sensitivity.

## Chronological discipline

The common 30-minute history is divided chronologically:

- Development: first 60%;
- Validation: next 20%;
- Holdout: final 20%.

A candidate passes Development only when it has at least 20 cycles, at least four sessions, positive average net in Normal, P95 and Severe, Normal positive rate at least 55%, and Normal PF above 1.0.

Development passers are screened on Validation using the same conditions with at least eight cycles. If multiple candidates pass Validation, one candidate is selected before Holdout using highest Validation Severe average, then Normal average, then shorter hold as the tie-breaker. Holdout is evaluated once.

## Interpretation boundary

Thirty-minute candles cannot reconstruct displayed queue, queue cancellations, aggressive trade direction, partial fills, exact top-of-book, or the frozen 250 ms hedge path. This test measures whether longer price-path convergence is large and stable enough to survive the frozen cost envelopes. It does not establish executable Maker performance.

The historical window overlaps the previously inspected V12/V12B history. Any passing result remains historical Shadow evidence and requires untouched Forward execution evidence.

## Safety

Research only. Production, LIVE, VPS, Crypto V96, V11, real orders and the V13 Forward collector remain unchanged.
