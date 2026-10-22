# FET BRK48 LONG trailing-stop Production plan

> **Execution note:** Follow the TDD loop for each implementation step. Keep the
> research replay and the live venue lifecycle as separate evidence classes.

**Goal:** Add the adopted `FET_TRAIL_8P_GIVEBACK_4P` policy to the FET BRK48
LONG live path without changing entry, sizing, the existing hard stop,
the existing +5%/+3% floor, or the 24-hour exit.

**Safety contract:** The policy reads only confirmed 5-minute candles, uses the
venue-reconciled average entry price, persists high-water state, and only
tightens a LONG stop. A replacement STOP must be accepted and read back as a
reduce-only order before the previous protection is canceled. Missing/invalid
5-minute data leaves the existing protection in place and does not create a
synthetic exit. No test order or manual close is allowed.

## Steps

1. Inspect and freeze the current FET state/wiring contract and record the
   research provenance and selected-case hashes.
2. Add failing pure-policy tests for confirmed-M5 arming, high-water updates,
   four-point giveback, monotonicity, duplicate/old bars, gap behavior, and
   LONG-only scope.
3. Implement the pure trailing policy and backward-compatible persisted state.
4. Add failing live-runner tests for confirmed-bar loading, actual entry-price
   use, restart persistence, partial-quantity protection, and safe STOP
   replacement ordering.
5. Integrate the policy into the FET position-management path. Preserve the
   existing exits and use one effective stop: the most protective of the hard
   stop, existing profit floor, and trailing stop.
6. Add an explicit SHA-bound runtime flag/policy contract and update systemd
   wiring/tests. Default-disabled behavior must remain safe on rollback.
7. [x] Run focused tests, type checks, and relevant production safety tests.
   Run the research replay/parity checks available from the pinned research
   source separately and keep their evidence class distinct.
8. Commit and push only the source, tests, provenance, and reproducible report
   under the prescribed research output root. Confirm remote SHA/CI.
9. Perform VPS read-only preflight and Aster signed read-back. Stage an
   immutable release, preserve rollback, and activate only through the existing
   operator gate. Do not alter existing positions or delete protection during
   deployment.
10. Restart only the FET unit if state/protection reconciliation is safe, then
    audit all runners, shared risk, margin guard, kill switch, rate budget,
    open positions/orders, and runtime SHA. Report venue lifecycle as
    unobserved unless a real FET trailing STOP event is independently read back.
