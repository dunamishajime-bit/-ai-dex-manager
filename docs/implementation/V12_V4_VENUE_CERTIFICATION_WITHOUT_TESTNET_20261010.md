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
