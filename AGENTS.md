# AI agent operations — DisDex Manager

## Mandatory VPS access preflight

**Before every task that involves inspecting, troubleshooting, modifying, restarting, or deploying to the Xserver VPS, first read** [the verified VPS SSH access runbook](docs/ops/DISDEX_VPS_SSH_ACCESS_20261012.md).

**Verified route (2026-10-12):** authorized Windows PC remote connector → Git for Windows SSH → existing local Desktop `DisDex.pem` → Xserver VPS root SSH. Prefer `C:\Users\dis\Desktop\DisDex-VPS-GitSSH.ps1`. Use `-CheckOnly` before work, and use `-ScriptPath C:\Users\dis\Desktop\DisDex-VPS-ReadOnly-Audit.sh` for a read-only VPS state check. Refer to the full runbook for exact commands and safety criteria.

Do **not** default to `C:\Windows\System32\OpenSSH\ssh.exe`: as last verified it exited with **255 even on `-V`**. The Git SSH route has been tested and works; standard Windows SSH has not been repaired. If a tool cannot reach the authorized owner PC, state this instead of claiming VPS access or guessing.

Before any production change, obtain fresh production SHA/current/previous release, Runner and watchdog state, signed Aster open positions/open orders, resident STOP protection, pending exposure, Kill Switch, shared risk, Margin Guard, account/rate-budget locks, and rollback plan. Merely gaining SSH access is **not** permission to bypass existing order, LIVE or operator certification gates. Avoid unrelated restarts and never expose secrets. Recheck after making a change and report actual results.

The runbook is the source of truth for connection details. Historical snapshots must not be used as current runtime evidence.
