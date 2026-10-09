# V12 V4 Production certification implementation plan
> For agentic workers: execute independent audit tasks with review before live mutation.
Goal: prepare and certify the user-selected V2_M150_D05_CORE_NATIVE against current ce1edeea without weakening protected holdings.
Architecture: current hardened runtime is authoritative; frozen research priority remains retrospectively fitted. Offline lifecycle, runtime adapters, HP and safety recovery are independently tested; actual order authority stays disabled until all evidence passes.
Tech Stack: TypeScript/Node, Python, Aster signed GET, systemd/Xserver.
Spec: docs/implementation/V12_V4_V2_LIVE_PARITY_AUDIT_20261009.md; docs/implementation/V12_V4_V2_M150_PRODUCTION_GATE_20261009.md; user ten-step mandate.
Global Constraints: retain TSLA0.38/PENGU7718 and STOP; no unconditional kill/lock/state deletion; no old-runtime rollback; cap changes only after8-system risk certification; 10/20/30bps, DD<=20%, independent evidence required for promotion.
Review Focus: ambiguous venue absence, changed ownership/protection, closed-session reference health, hindsight policy leakage, pending reservation orphan/double allocation.
## Task 1: signed absent-pending reconciliation preserving HOLD
Files: scripts/ops/root/disdex-v12-absent-pending-policy.mjs, its test, disdex-v12-absent-pending-reconcile.mjs.
- [x] Require three fresh signed GET rounds, exact400/-2013, full recent trade interval, no XRP position/order/fill, stable whole-account positions and protective orders.
- [x] Test unknown lookup, filled-and-closed history, exposure/order/STOP change, stale/malformed/time interval, runtime mismatch rejection.
- [x] Acquire existing account lock normally, verify V12 stopped, preserve shared and local kill/manual review, CAS archive state before changing one proven absent pending and its exactly matched reservation.
- [x] Review and dry run, then apply without orders/cancels/restarts; verify idempotency, holdings and protection unchanged.
## Task 2: V52 operational causes
Files: scripts/disdex_stock_reference_alpaca_proxy.py, scripts/disdex_v52_aster_only_legacy_engine.py and targeted Python tests.
- [x] Prove true feed freshness vs market closure; validate stream ACK/stall recovery without TTL widening.
- [x] Test closed-position read-only daily guard avoids order lock and retains emergency-flatten lock.
- [x] Record historical protected hold; separate later signed flat recovery performed by another task. Regular-session TSLA freshness remains unproved.
## Task 3: V4 executable preparation
Files: lib/v12-v4-production-lifecycle.ts, features.ts, offline runner, tests.
- [x] Implement closed-H1 predicates and executable exit definitions where source specifies them; native G3 proved1978/1978; block unknown native Entry and venue adapters.
- [x] Test quantity floors, reservations, aggregate caps with foreign holdings, fills/partials/restart/dedup/ownership.
- [x] Offline execution must not imply real-order bridge or strategy promotion.
## Task 4: evidence replay and HP
Files: scripts/research/v4-production-cert*, docs/research/results/v4-production-cert-20261009/*, V12V4ShadowPanel/server/helper tests.
- [x] Reproduce all3 baseline costs and independent frozen-priority translation, report all8 per-logic metrics and precise parity gaps.
- [x] Verify strict venue-filter counterfactual, separate full-year hindsight from temporally causal forward scoring.
- [x] Fail closed on stale/unsafe shadow artifact and legacy LIVE badges; research remains separate from actual runtime.
## Task 5: closure
- [x] Run scoped and full affected suites, type checks, deterministic replays, independent review.
- [x] Commit/push source/evidence; keep Production/HP current if DD/external/full8 execution certification fails.
- [x] Report exact source/Production/UI SHA, runners, shared hold, real positions/STOP, baseline reproducibility and remaining blockers. No LIVE claim without certification.

Final adoption verdict: BLOCKED. Native source generation, all8 current-runtime parity, independent full8 MTM DD and venue execution remain unfinished certification requirements. Checked plan items record preparation/tests and conditional decision, not completedLIVE implementation.
