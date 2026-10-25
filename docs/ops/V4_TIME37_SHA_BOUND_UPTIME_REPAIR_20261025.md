# V4 TIME37 SHA-bound approval / fail-closed daemon repair — 2026-10-25

## Observed production incident (read-only evidence)
At 2026-10-25 03:01 JST, `disdex-v12-v4@fa202b371f2d23a025eb4113d6ae775d16987f11.service` exited status 2 with `V4_TIME_STOP_OPERATOR_APPROVAL_REQUIRED`. The root-owned shared approval `/etc/disdex/v12-v4-time-stop-approval.json` instead named `df85fad35a3d357730ff5b853e7766ad6991543e`, so the current runner could not obtain an exact-SHA TIME37 approval during a decision. `RestartPreventExitStatus=2` intentionally prevented blind restarts.

## Repair on this branch
- TIME37 approval lookup uses a distinct root-owned `/etc/disdex/v12-v4-time-stop-approvals/<EXACT_40_CHARACTER_SHA>.json` for each release. Only that SHA is accepted. The release cannot consume an approval file for another SHA.
- At each daemon tick, prior to market evaluation or any new flat ENTRY, the runner verifies the exact-SHA operator approval. If it is absent or does not authorize the running SHA, the daemon remains up and emits `status=blocked`, `safetyState=BLOCKED`, `orderEnabled=false` with a 60-second retry **only when the signed execution store proves zero active intent, leg and STOP**.
- If an unresolved intent, owned position, resident STOP or unrecognized validation error exists, the strict fatal fail-closed behavior is **not** softened. No general systemd restart override is permitted for exit code 2.
- The emergency quote remains LONG `entry*0.92`, SHORT `entry*1.08` for exactly the TIME37 routes. The market/STOP policy and trading authorization have not been changed.

## Production activation conditions
This branch is **research/repair code only** until code checks complete, root-owned per-SHA approval for the eventual final SHA is explicitly issued by the operator, and separate final-SHA LIVE activation is independently checked. Neither a previous approval nor an operator-activation artifact for an older SHA is sufficient.

An operator should retain existing LIVE configuration, inspect live order/position/protection state before any restart, verify current Git SHA and test results, ensure that only one V4 runner is active, and install the approved final-SHA TIME37 JSON with owner `root:deploy`, mode `0640` inside a root-controlled directory with no symlink. Verify validation with the actual `deploy` user and release binary before starting new runner. The deployer must not fabricate an acknowledgement, silently copy an old SHA-specific approval, or overwrite the mutable legacy approval. Rollback must retain the prior approved release and root-owned artifact.

No VPS release deployment, systemd restart, real exchange requests, orders, cancellations or position mutation are part of this branch.
