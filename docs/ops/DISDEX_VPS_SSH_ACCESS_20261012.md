# DisDex VPS access — required preflight for AI operators

**Recorded:** 2026-10-12 JST  
**Repository:** `dunamishajime-bit/-ai-dex-manager`  
**Scope:** Xserver VPS access from the owner's Windows PC for auditing, maintenance, code fixes, deployment, and LIVE checks.

## ALWAYS READ THIS FIRST

Before **every task that touches the VPS**, each AI/operator (ChatGPT, Codex, Work, and other agents) must:

1. Read this document and the repository-root `AGENTS.md`.
2. Check that the owner's Windows PC remote connection is online and authorized.
3. Prefer the verified **Git for Windows SSH** route rather than relying on the Windows built-in `ssh.exe`.
4. Run a **read-only connection check** and inspect current VPS state before performing any writes.
5. Verify present `current` release/SHA, services and Runner PIDs, restart counts, Aster positions, open orders, pending exposure, shared Gross/Margin Guard/Kill Switch, locks and rollback target. Do not act on historical status alone.

## Verified connection path

```
ChatGPT / Codex / AI
  -> authorized Windows PC remote connector
  -> Windows PowerShell 5.1
  -> Git for Windows SSH client
  -> existing Desktop/DisDex.pem (local private key; never copy or print)
  -> Xserver VPS root SSH
  -> Linux bash and systemd
```

Windows client: `C:\Program Files\Git\usr\bin\ssh.exe`  
Local launcher: `C:\Users\dis\Desktop\DisDex-VPS-GitSSH.ps1`  
Read-only audit: `C:\Users\dis\Desktop\DisDex-VPS-ReadOnly-Audit.sh`

The launcher contains the verified VPS endpoint, the existing local key path, `BatchMode=yes`, `IdentitiesOnly=yes`, `ConnectTimeout=12`, `StrictHostKeyChecking=yes`, and a **stdin-to-`bash -s`** transport (not a fragile nested SSH quoting command). The private key remains only on the Windows PC. Do not add the endpoint/credential to application logs, chat output or source code unnecessarily.

### Connection test (PowerShell on owner's Windows PC)

```powershell
& "$env:USERPROFILE\Desktop\DisDex-VPS-GitSSH.ps1" -CheckOnly
```

Expected: `DISDEX_SSH_OK`, `root`, VPS hostname. A failed command must be investigated; do not assume it worked.

### Read-only VPS audit

```powershell
& "$env:USERPROFILE\Desktop\DisDex-VPS-GitSSH.ps1" -ScriptPath "$env:USERPROFILE\Desktop\DisDex-VPS-ReadOnly-Audit.sh"
```

This prints `current` and `previous` releases, relevant services/PIDs/restarts, V4 health/order state, recent Canary reasons, historical venue evidence, failed services and disk capacity. It is **not** a complete independent signed exchange position audit: use the approved signed **GET-only** Aster audit for fresh positions/orders when needed.

### Running a different authorized command/script

Write a UTF-8 `*.sh` script on the Windows PC with explicit checks, preferably `set -euo pipefail`, then pass `-ScriptPath` to the same launcher. The launcher strips Windows CRLF and streams the script via stdin to remote `bash -s`. Check exit status and output. Avoid interpolating sensitive values or pasting multi-layer quote-heavy SSH one-liners.

## Provenance & limitations

On **2026-10-12**, built-in Windows OpenSSH (`C:\Windows\System32\OpenSSH\ssh.exe`) returned exit code **255 even for `-V`**, with no useful output. Git for Windows SSH returned **0**, authenticated with the existing key to the Xserver VPS as root, and executed commands successfully. The launcher and audit were tested end to end. The built-in client has **not** been repaired; do not claim it is working. Repair of system OpenSSH requires separate Windows administration, not removal of safety checks.

The established channel supports reading and executing commands with root permissions, which allows authorized edits and deployment. **An actual VPS file-write transaction was not independently tested in this verification**, so do not label end-to-end write/edit as tested until a controlled safe edit is verified.

## Trading safety and production gates

- Connectivity does **not** imply approval to place live orders, move/close positions, cancel resident STOPs, modify Kill Switch, or bypass operator/source/venue certificate gates.
- Use the exact current release and root-owned operator artifacts, not a guessed SHA.
- Before switching V12 V4 from Canary to LIVE, independently certify real Aster execution lifecycle, protective reduce-only STOP and partial fills, recovery/restarts, same-symbol ownership and peer locks, active positions/orders/pending exposure, Gross, Margin Guard, release and rollback.
- Keep other active Runners and protected positions safe; do not mass-restart or reset locks to make a check pass.
- When remote PC is offline, report the connectivity blocker, do not silently substitute unverified access or claim that the VPS was inspected.

## Historical snapshot only — never use as current state

At approximately 08:53 JST on 2026-10-12: production `current` pointed to `ce1edeead8d0f9e5d88e829d415057117502a335`, V4 Canary `447205ee22ab64d2d0013922eeccfd4a1e14a72f` was running with `orderEnabled=false`, and FET had an open position with a reduce-only protective STOP on the independent signed read-only Aster check. State must be re-fetched every time.

**Never store private key contents, API secrets, or passwords in this repository or runbook.**
