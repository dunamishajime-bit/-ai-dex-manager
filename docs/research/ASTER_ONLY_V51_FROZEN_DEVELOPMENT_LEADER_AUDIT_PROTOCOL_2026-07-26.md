# Aster-only V51 Frozen Development Leader Audit Protocol

## Purpose

V50 produced standalone full-year candidates above +50%, but no candidate met the original fixed Validation minimum of eight trades. V51 does not alter that result.

V51 selects exactly one V50 candidate using Development only, freezes it, and audits all later chronological data as a combined post-Development segment.

## Selection

- Candidate universe: the original 162 frozen V50 candidates.
- Eligibility: original V50 Development gate.
- Selection score: Development Normal return plus Development P95 return.
- Tie break: candidate ID.
- Validation, Final and July Holdout are not used to select.

## Additional audit

- full standalone Normal and P95;
- combined Validation + Final + July Holdout performance;
- 50 bps and 60 bps round-trip costs;
- leave-one-symbol-out tests;
- each entry-window ablation;
- monthly performance;
- original best-trade, best-month, concentration and Severe checks.

## Interpretation

Passing V51 would mean the Development-selected standalone engine remained profitable across a larger post-selection sample. It would not override the original V50 Validation-count failure and would not authorize Production or LIVE use.

## Safety

Research only. Production, LIVE, VPS, credentials, orders, V96, V11-EQ, V19, V48 and V50 Production remain unchanged.
