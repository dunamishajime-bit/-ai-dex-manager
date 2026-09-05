# Task 6 final review round 2 — RESOLVED

Review target: `52683dab..HEAD` (`875ce766`) in `C:\Users\dis\-ai-dex-manager\.worktrees\quality102-live-connection-20260904`.

Reviewer configuration: `gpt-5.6-luna`, medium. No source, deployment, VPS, systemd, exchange, or order state was modified.

## Findings

### [P1] Keep Q102 fail-closed regardless of a hostile or drifted heartbeat

`lib/disdex-runtime-status.ts:66-71` permits any fresh, service-active Q102 heartbeat with `safetyState: "LIVE"` and `liveEnabled: true` to project as `LIVE`. The returned `quality102` metadata says `historicalSelectorParity: false` and `brkLiveEnabled: false`, but those fields do not constrain `state`; the heartbeat's optional Q102 metadata is also not validated against the canonical fail-closed contract. A schema-valid or drifted Q102 heartbeat can therefore make HP show LIVE while the Task 6 brief requires Q102 `LIVE_BLOCKED_FAIL_CLOSED` semantics. Apply a Q102-specific fail-closed gate (or validate the heartbeat metadata and require the causal runner's explicit safe state) and add a regression fixture with a fresh active Q102 heartbeat claiming LIVE.

### [P1] Do not trust heartbeat-provided Q102 caps as the public contract

`lib/disdex-runtime-status.ts:128` forwards `heartbeat.caps` unchanged for every runner, including Q102. A validly parsed Q102 heartbeat with `{strategy: 99, crypto: 99, total: 99}` would be returned as the Q102 cap display, contradicting the required canonical `0.50x`, `2.00x`, and `2.50x` caps. The focused test only exercises the expected values, so it does not detect drift or tampering. Enforce the canonical Q102 caps (or reject the record to `要確認`) and test mismatched values.

### [P1] The production API has no source for explicit observed service activity

`app/api/strategy/runtime-status/route.ts:6-8` calls `normalizeRuntimeStatus()` without `serviceActiveByRunner`. `lib/disdex-runtime-status.ts:106-110` consequently sets every `serviceActive` value to false, and `publicState()` maps every otherwise healthy heartbeat to `要確認`. This is safe against false LIVE, but the deployed GET endpoint can never report a legitimate LIVE state because it does not observe systemd/service activity. Wire the route to the approved read-only service-status observation source, or make the endpoint explicitly a non-LIVE/unobserved projection and document that behavior as the intended contract.

## Requirements confirmed

- The current implementation reads only the four allowlisted heartbeat filenames and rejects runnerId/filename cross-binding; the regression test covers every allowlisted filename permutation.
- LIVE now requires `serviceActiveByRunner[runnerId] === true`, fresh heartbeat data, matching runtime/expected SHA identity, `safetyState: LIVE`, and `liveEnabled: true`.
- Absent, malformed, stale/future-dated, and SHA-mismatched data maps to `要確認` with `releaseShaMatch: false` and non-secret reasons.
- Symbols are sourced from the heartbeat and non-market/hostile values are replaced with `[REDACTED]`; the current fixtures cover credential-shaped, wallet-shaped, and `0x` values. This still needs the Q102 fail-closed/cap enforcement above.
- Exactly four normalized records are emitted, with Q102 parity false and BRK live disabled metadata.
- No exchange/write client, order/cancel/position mutation, VPS, or deployment path is used by the Task 6 implementation.
- Public projection omits heartbeat private fields such as working directory and service unit and redacts tested credential/path/order-id patterns.

## Verification

- `npx tsx --test tests/disdex_runtime_status.test.ts` — PASS, 7 passed, 0 failed (the initial sandbox attempt was `spawn EPERM`; the unchanged command was rerun with approved execution).
- `npx tsc --noEmit` — PASS, exit 0.
- `git diff --check 52683dab HEAD` — PASS, exit 0.
- Worktree status before this report was clean; the only newly written file is this review artifact.

## Resolution

- Q102 is now explicitly gated to public `FAIL_CLOSED` whenever its heartbeat is fresh and identity-valid; a hostile fresh heartbeat claiming `LIVE` and `liveEnabled=true` is projected as `LIVE_BLOCKED_FAIL_CLOSED` with the non-secret reason `Q102 selector parity is unproven; LIVE blocked fail-closed`. Q102 can never project public `LIVE`.
- Q102 public caps are canonical and fixed at strategy `0.50`, crypto `2.00`, and total `2.50`; heartbeat cap drift is not trusted. Regression coverage includes mismatched heartbeat caps.
- The production API now invokes the narrow read-only service observer. It checks only the convention-defined, statically allowlisted systemd units with `systemctl is-active --quiet`, performs no writes or exchange calls, and returns explicit `serviceActivity: UNAVAILABLE` when configuration or observation is unavailable. Unobserved service activity cannot produce `LIVE`.

## Round 2 verification

- `npx tsx --test tests/disdex_runtime_status.test.ts` — PASS, 10 passed, 0 failed.
- `npx tsc --noEmit` — PASS, exit 0.
- `git diff --check` — PASS, exit 0.
- No deployment, VPS/systemd mutation, exchange access, or order/write behavior was performed.
