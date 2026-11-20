# AI agent operations — DisDex Manager

## Mandatory VPS access preflight

**Before every task that involves inspecting, troubleshooting, modifying, restarting, or deploying to the Xserver VPS, first read** [the verified VPS SSH access runbook](docs/ops/DISDEX_VPS_SSH_ACCESS_20261012.md).

**Verified route (2026-10-12):** authorized Windows PC remote connector → Git for Windows SSH → existing local Desktop `DisDex.pem` → Xserver VPS root SSH. Prefer `C:\Users\dis\Desktop\DisDex-VPS-GitSSH.ps1`. Use `-CheckOnly` before work, and use `-ScriptPath C:\Users\dis\Desktop\DisDex-VPS-ReadOnly-Audit.sh` for a read-only VPS state check. Refer to the full runbook for exact commands and safety criteria.

Do **not** default to `C:\Windows\System32\OpenSSH\ssh.exe`: as last verified it exited with **255 even on `-V`**. The Git SSH route has been tested and works; standard Windows SSH has not been repaired. If a tool cannot reach the authorized owner PC, state this instead of claiming VPS access or guessing.

Before any production change, obtain fresh production SHA/current/previous release, Runner and watchdog state, signed Aster open positions/open orders, resident STOP protection, pending exposure, Kill Switch, shared risk, Margin Guard, account/rate-budget locks, and rollback plan. Merely gaining SSH access is **not** permission to bypass existing order, LIVE or operator certification gates. Avoid unrelated restarts and never expose secrets. Recheck after making a change and report actual results.

The runbook is the source of truth for connection details. Historical snapshots must not be used as current runtime evidence.


## Release campaign approval discipline

- Treat an Owner-requested cutover as **one engineering campaign**, not a new HP approval for every source fix. Run tests, CI, read-only diagnostics, and all safely available readiness checks *before* publishing the final exact-SHA HP Owner approval. Aggregate fixes and freeze one immutable SHA/plan for final execution.
- Before asking the Owner to approve again, query the existing approval ID/status and compare exact operation, scope, target SHA, plan SHA256, ordersEnabled, and validity. For the same orders-disabled `ALL_RUNNERS_MONITOR_REFRESH` identity, a previously REDEEMED approval is retryable for at most 24 hours from approvedAt under the official authenticated workflow; do **not** create a new OTP request merely because a GitHub run or transport token failed.
- Changes to the target SHA, plan, operation, or order authority create a **different** immutable approval identity. Do not authorize it with an old signature. Finish all remaining repairs before seeking a single final approval for that new identity; explain the change in one concise message.
- HP approval and GitHub protected Environment approval are distinct, and new workflow runs may require a new GitHub review. Never bypass either. Keep signature, nonce replay, Fail Closed, HOLD/STOP/position protections, and separate order-enable authorization unchanged.
- Record current approval ID (not credential/token), eligible reuse state, exact candidate identity, failed gate, and next safe action in the task checkpoint. If identical retries have no new evidence, diagnose rather than re-prompting Owner.
