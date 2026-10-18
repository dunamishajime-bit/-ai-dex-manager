# V12 V4 — Venue certification without a usable Testnet (2026-10-10)

STATUS: TESTNET_NOT_MANDATORY / EQUIVALENT_REAL_VENUE_EVIDENCE_REQUIRED / LIVE_UNCHANGED

## Decision

Aster Futures V3 Testnet is an optional evidence source. It is not a mandatory
Production cutover condition. A Testnet funding or account-activation blocker
must not create an indefinite deployment deadlock when equivalent evidence can
be collected from another authentic Aster execution path.

This does not waive execution safety. Mock, unit, or fault-injection evidence
alone cannot grant LIVE authority.

## Accepted venue-evidence modes

The root-managed Production certificate v2 must name exactly one evidence mode:

1. ASTER_TESTNET — signed Testnet orders, positions, and lifecycle evidence.
2. AUTHENTIC_PRODUCTION_HISTORY — independently extracted authentic existing
   Aster Production order, trade, STOP, position, and restart evidence.
3. CONTROLLED_PRODUCTION_CANARY — a deliberately constrained Production canary
   only when authentic history cannot establish the needed semantics and the
   operator separately approves that canary.

Every mode requires SHA-256 evidence for signed orders, signed positions,
restart recovery, and same-symbol race protection. It must also state
realVenueObserved=true and simulatedOnly=false.

## Required invariants regardless of mode

- exact-release SHA and 41-route source and exit evidence;
- authentic Aster order and position observations;
- reduceOnly and STOP ownership plus remaining-quantity proof;
- restart and unknown-result recovery without duplicate sends;
- same-symbol virtual-leg protection proof;
- shared Gross, Margin, Kill Switch, and peer ownership consistency;
- root-managed TIME37 policy approval and Production certificate;
- final explicit Operator LIVE authorization.

Testnet failure by itself is no longer a blocker. Missing equivalent authentic
venue lifecycle evidence remains a blocker.

## Current state

The Testnet account returned HTTP 400 / Aster code -5050 during signed
read-only preflight, so it was not usable for certification at that moment.
Free funding attempts did not establish a usable Perps Testnet balance.
The preferred path is now AUTHENTIC_PRODUCTION_HISTORY. This document does not
authorize any Production mutation.


## 2026-10-19 clarification: direct V3 certification, not mandatory canary

The preceding 2026-10-10 guidance describes the original **V2** evidence contract.
The current production code also implements
`disdex-v12-v4-production-certification/v3` in
`lib/v12-v4-certified-gates.ts`. This path expressly permits
`ESTABLISHED_ASTER_PRODUCTION_EXECUTION` evidence without a preceding
V4-specific first fill. Consequently **Testnet and a mandatory first
Canary fill are not prerequisites** for direct V4 `CERTIFIED` activation
when the current exact-SHA V3 evidence and operator approval validate.

Do not conflate (a) allowing V4 to start with an authentic established
venue history basis with (b) claiming a first V4-specific fill/STOP
lifecycle has already been observed. The latter must remain truthfully
unobserved until forward execution occurs.

Neither the original V2 nor current V3 contract permits copying an older
certificate to a new SHA, treating mismatched risk Gross caps as equal,
misrepresenting `marginGuardHealthy=false` evidence, or enabling LIVE by
flipping mode flags without a valid root certificate and separate operator
authorization. See
`docs/implementation/DIRECT_V4_CERTIFICATION_AND_FULL_LIVE_REPAIR_20261019.md`
for scoped activation and repair prerequisites.
