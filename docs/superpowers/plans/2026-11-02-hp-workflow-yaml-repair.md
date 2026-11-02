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
