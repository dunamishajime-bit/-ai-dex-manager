# AI agent operations — DisDex Manager

## Mandatory VPS access preflight

**Before every task that involves inspecting, troubleshooting, modifying, restarting, or deploying to the Xserver VPS, first read** [the verified VPS SSH access runbook](docs/ops/DISDEX_VPS_SSH_ACCESS_20261012.md).

**Verified route (2026-10-12):** authorized Windows PC remote connector → Git for Windows SSH → existing local Desktop `DisDex.pem` → Xserver VPS root SSH. Prefer `C:\Users\dis\Desktop\DisDex-VPS-GitSSH.ps1`. Use `-CheckOnly` before work, and use `-ScriptPath C:\Users\dis\Desktop\DisDex-VPS-ReadOnly-Audit.sh` for a read-only VPS state check. Refer to the full runbook for exact commands and safety criteria.

Do **not** default to `C:\Windows\System32\OpenSSH\ssh.exe`: as last verified it exited with **255 even on `-V`**. The Git SSH route has been tested and works; standard Windows SSH has not been repaired. If a tool cannot reach the authorized owner PC, state this instead of claiming VPS access or guessing.

Before any production change, obtain fresh production SHA/current/previous release, Runner and watchdog state, signed Aster open positions/open orders, resident STOP protection, pending exposure, Kill Switch, shared risk, Margin Guard, account/rate-budget locks, and rollback plan. Merely gaining SSH access is **not** permission to bypass existing order, LIVE or operator certification gates. Avoid unrelated restarts and never expose secrets. Recheck after making a change and report actual results.

The runbook is the source of truth for connection details. Historical snapshots must not be used as current runtime evidence.


## Goal-scoped Owner consent: one purpose, not one SHA

- The user's requested authorization unit is a stable **operational objective** (e.g. restore the named stopped Runner(s) to LIVE, or switch a named logic), not each intermediate code SHA or revision of the plan. Do not re-request HP Owner approval merely because repair work changes the SHA or plan.
- Create or reuse the single approved goal charter ID. It fixes the task kind, named target, affected Runner scope, strategy identity where applicable, destination, safeguards and **maximum permitted order authority**. Any child attempt must preserve that immutable envelope.
- Every changed SHA or execution plan still requires fresh exact-candidate CI evidence, immutable plan-content verification, a new short-lived Ed25519 token for that candidate, GitHub protected Environment checks and independent Root/venue/STOP/HOLD/Shared Risk preflight. The goal certificate does not itself permit execution.
- Only use `publish_goal` / `claim_goal_release` / `finish_goal_release` when the tested workflow is merged, deployed and available. Legacy exact-SHA approvals cannot be reinterpreted as broad goal certificates. Do not work around missing authentication by changing environment protection, stale nonce, signatures or order gating.
- If the new path is unavailable: continue safe source/CI/read-only repairs, record `GOAL_APPROVAL_FLOW_NOT_ACTIVE` **once** as a blocker, and request the final formal transition after the new path is certified. Never prompt for a new HP code after every debugging commit.
- A genuinely new goal (new Runner, different logic, changed destination or higher trade authority) requires a separate explicit scope; work already within the approved goal does not. Goal stays active until successful completion or explicit Owner revocation, with per-release audit trace.
- Production mutations are never authorized by this AGENTS.md file alone. Formal Owner proof, code/plan provenance and root fail-closed contracts all remain mandatory.
