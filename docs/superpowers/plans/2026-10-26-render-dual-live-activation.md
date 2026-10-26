# RENDER dual-route certification and guarded LIVE activation plan

> Scope: implement and verify the RENDER dual-route contract from commit `63434ebd37496b324ebe4fc4d1a7da9a6146383f` without changing existing positions, protections, or unrelated runners.

## Safety invariants

- Keep current VPS Production and V4 releases unchanged until all candidate checks pass.
- Do not fabricate or copy SHA-bound operator certificates.
- Keep both RENDER LIVE flags disabled until source SHA, operator approval, venue lifecycle evidence, and HP telemetry agree.
- Do not force-close existing positions, cancel protections, or place a real canary order as part of local implementation.
- Treat research/backtest evidence as modeled evidence, never as proof of venue execution.

## Implementation phases

### 1. Reproduce and capture the candidate failures

- Install dependencies only in this isolated implementation tree.
- Run typecheck, focused RENDER tests, Idle self-test, and relevant HP tests.
- Preserve the existing failing import-interop test as the first regression target.
- Inventory all RENDER contract constants and identify stale 0.25x/55-minute/TP1.5% display paths.

### 2. Repair the RENDER contract and monitor

- Fix the ESM-to-TS module interop in `render-highwr-shadow-review.mjs` without weakening any gate.
- Make the read-only review output consume the canonical independent route contract: gross max 0.75x, 5x Cross, TP +2.5%, STOP -2%, maximum hold 6 hours, cooldown 12 hours.
- Keep the legacy route at its existing entry, gross 0.25x, STOP -10%, TP +25%, and trailing behavior; add only the confirmed-M5 adverse watch of 120 minutes with MFE < +0.25%.
- Add regression coverage so stale route values cannot reappear in monitor output or execution metadata.

### 3. Add truthful HP telemetry

- Extend the Idle/RENDER decision detail contract with separate legacy and independent route records.
- Include route identity, source/runtime SHA, certification state, gate result/reason, owner/flat-core admission, gross request/actual, 5x Cross configuration, protection plan, cooldown, and order permission.
- Update the API and decision-status page to show `CERTIFIED`, `SHADOW`, `BLOCKED`, and `ORDER_ALLOWED` distinctly.
- Display explicit reasons for absent data or disabled orders; never infer LIVE permission from heartbeat alone.
- Add API/UI tests for SHA mismatch, missing certificate, stale telemetry, and healthy-but-order-disabled states.

### 4. Verify locally and reproduce the 8-sleeve research evidence

- Run typecheck and all focused RENDER/Idle/UI tests.
- Run the repository's full relevant regression suite and record failures by cause.
- Re-run the 8-sleeve integrated BT at 10bps and 30bps with the current route contract.
- Save reproducible BT outputs, manifests, logs, and source references under `C:\Users\dis\Desktop\DisDex_AI_Files\01_BT_Research\2026-10-26_render-dual-final-activation`.
- Clearly label the BT as research and do not use it as venue certification.

### 5. Commit, push, and CI gate

- Commit only the intended source, tests, docs, and HP changes.
- Push the implementation branch and run the repository's canonical CI against the exact candidate SHA.
- Do not advance to VPS deployment if exact-SHA CI is absent or failing.

### 6. VPS staging and final authorization audit

- Read-only re-check current Production, V4, all Runner SHAs, systemd units, positions, open orders, protections, Shared Risk, Margin Guard, Account Lock, and HP telemetry.
- Stage the exact candidate release without enabling either RENDER order flag.
- Verify rollback and single-active-unit behavior.
- Verify root-owned, exact-SHA-bound formal certificates only if the authorized operator process creates them from real evidence.
- Verify venue lifecycle evidence for 5x Cross, precision, partial fill, resident STOP/TP, restart recovery, six-hour exit, and legacy M5/MFE.
- If any proof is missing, leave RENDER new orders disabled and report `BLOCKED` with the exact condition.

### 7. Guarded LIVE cutover, only if every gate is proven

- Switch the candidate release and relevant systemd unit atomically, after confirming no duplicate V4/RENDER process.
- Preserve existing positions and protections.
- Enable only the formally authorized RENDER flags for the exact SHA.
- Confirm at least three normal decision cycles and reconcile VPS/HP state.
- Confirm real order permission separately from an actual fill; do not claim a fill unless the exchange reports one.
- Record the rollback SHA and final evidence.

## Completion criteria

The task may be reported as `V4_LIVE_RUNNING_VERIFIED` / RENDER LIVE verified only when exact-SHA CI, root-owned approvals, venue lifecycle evidence, three live cycles, HP parity, and runner/account safety checks all pass. Otherwise report `BLOCKED` and preserve the fail-closed state.
