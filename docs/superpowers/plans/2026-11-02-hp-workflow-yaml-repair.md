# HP Production Approval Workflow YAML Repair

**Goal:** Restore parsing of the existing protected HP deployment workflow without changing its approval or deployment rules.

**Architecture:** Preserve the existing workflow and replace the embedded raw carriage return in the AWK expression with its escaped representation. Add a regression check and run it in the existing HP approval CI.

**Constraints:** No Production mutation, approval bypass, order permission change, or runner restart. Keep the protected Environment and redirect check unchanged.

## Task: workflow parsing regression

- [ ] Add a test that rejects a carriage return not followed by line feed in the actual HP workflow, then confirm it fails on the existing file.
- [ ] Replace only the embedded carriage return with the AWK `\r` escape.
- [ ] Add the test to the existing HP approval CI workflow and its pull-request path filter.
- [ ] Run the regression and protected-environment tests, parse the actual YAML with an independent parser, and verify the diff preserves the approval gate and HTTP Location handling.
- [ ] Push the reviewed change for CI without deploying or enabling orders.

## Follow-up: prevent stale V4 witness promotion

- [ ] Exercise the actual witness collector with fresh, stale, future, missing, and mixed-generation source evidence; prove stale evidence currently passes incorrectly.
- [ ] Require every dynamic source to be within the existing signed-read diagnostic's 30-second age / 5-second clock-skew bound, and require one nonempty refresh generation across the three sources.
- [ ] Bound the output expiry by the earliest source capture rather than extending the evidence lifetime when the witness is generated.
- [ ] Do not claim all-runner heartbeat or tick verification before V4 starts, or when an approved peer is stopped.
- [ ] Reject missing/non-boolean Shared Risk trip state and malformed pending entries instead of treating them as clear.
- [ ] Apply strict pending validation, fresh 7.5% Shared Risk, and fresh Margin Guard checks to both the final audit and the order-enable gate.
- [ ] Load and require the real shared API budget in final signed GET and run it with the deploy account, avoiding root-owned shared-budget writes.
- [ ] Apply the same signed-GET budget and deploy-user checks to the V4/IDLE/HYPE recovery helper.
- [ ] Require valid fresh 7.5% risk and well-formed pending records in the recovery helper before any start.
- [ ] Fail closed for inactive runners until a genuinely order-disabled startup is certified; an `ordersEnabled=false` approval must not start an order-enabled unit.
- [ ] Run the V4 witness tests and all-runner safety tests; keep the witness unwired to production until the remaining runtime and ownership gaps are resolved.
- [ ] Run the witness, final-verify, and risk-freshness tests in GitHub CI when their sources change.
