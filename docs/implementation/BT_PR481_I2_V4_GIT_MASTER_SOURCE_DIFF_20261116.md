# BT-481-I2 | Git object comparison of V4 research source to repository master

Read-only Git evidence captured on 2026-11-16 (JST). **Not a production VPS inspection** and not a Codex deployment check.

- Frozen V4 research branch/commit: `9118eeaa6c209dc6e37887cf5be139b3baaa005d`.
- GitHub `master` head observed with `git ls-remote`: `6f1a14862fb2d2e458632580178cc91ca92540ed`.
- Reproducible comparator: `scripts/bt-hp-v4-research-vs-master-pin-audit.py`. It uses existing **local Git objects**, checks the master commit object, hashes the original sources and checks the exact same paths on `master`. It does not fetch, checkout, switch branches, merge or change LIVE.
- Machine-readable evidence: `reports/bt-verification/BT_PR481_I2_RESEARCH_VS_MASTER_PIN_20261116.json`.

**Result: all 11 frozen V4 source/config file paths examined are absent at those exact paths in the observed master tree.** This includes `lib/v12-v4-live-candidate-builder.ts`, the V2 shadow/production features/native H2 core, X1 policy/config and source catalogs. The current master tree still contains V4-oriented GitHub Actions and deployment overlay source templates in other locations. A file-path absence is **not evidence that an activated V4 Runner has stopped**, nor proof that source code was removed from VPS.

This is **not a source-equivalence test** of a deployed V4 SHA. Immutable Git master is only one code artifact; the operator-approved release, loaded runner process SHA, immutable manifest, formal approval and active STOP/position protection cannot be inferred from this Git tree. Furthermore, the frozen research V2 code itself declares `BLOCKED_HINDSIGHT_LEAKAGE_AND_EXTERNAL_Y06`. These facts prevent claiming production parity, a corrected Y06 strategy, or native executed fills.

**Resulting gate:** task BT-481-I is **blocked pending current deployed pin evidence and a genuine causal/OOS Y06 validation**. BT-481-I1 (reconstruction) and BT-481-I2 (Git-only comparison) are independently complete. Work on independent BT-481-J/K/L/M/N tasks can proceed without claiming current-V4 parity.

The original user-authorized isolation still holds: Production, Codex worktrees, real orders, STOP, Kill Switch, runner lifecycle and master have not been changed.
