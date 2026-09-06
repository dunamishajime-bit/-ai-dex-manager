# VPS runner-path reliability plan

**Spec:** `docs/superpowers/specs/2026-09-06-vps-runner-path-reliability.md`
**Goal:** remove the verified silent-skip paths while preserving fail-closed trading safety, then deploy and verify the current release on VPS without sending an order.
**Architecture:** small shared scheduling/heartbeat utilities; bounded read-only HTTP retry in `AsterV3Client`; bounded Q102 market-data workers; existing runners and planners unchanged.
**Tech stack:** TypeScript, Node test runner via `tsx`, Next.js build, systemd on Ubuntu VPS.

## Task 1: Add red tests for cycle retry, market-data retry/concurrency, and heartbeat

Files: `tests/disdex-runner-reliability.test.ts`, `tests/aster-v3-readonly-retry.test.ts`, `tests/quality102-market-data-concurrency.test.ts`, `tests/disdex-runner-heartbeat.test.ts`.

- Assert a locked cycle retries only within a bounded window and non-locked cycles use the regular boundary.
- Assert a read-only GET can recover from a transient 429/5xx or empty response, while a mutation is never retried.
- Assert Q102 symbol work never exceeds the configured concurrency and still rejects missing current-hour data.
- Assert heartbeat writes are atomic, contain the current release/non-secret state, and do not leave a partial target file.
- Run the new tests and confirm they fail against the current implementation.

## Task 2: Implement bounded cycle retry and heartbeat publication

Files: `lib/disdex-bounded-lock-retry.ts`, `lib/disdex-runner-heartbeat.ts`, `scripts/disdex-pengu-dual-ls-v2-live-runner.ts`, `scripts/disdex-quality102-causal-v1-live-runner.ts`, `scripts/disdex-v12-x1-all-live-runner.ts`.

- Add pure retry-window calculation and use it only for `status === "locked"`.
- Add atomic, permissioned, non-secret heartbeat writes and publish startup/cycle outcomes from all current runners.
- Preserve manual-review exits, kill switches, reconciliation gates, and existing V12 retry behavior.

## Task 3: Implement bounded read-only market-data recovery

Files: `lib/aster-v3-client.ts`, `lib/disdex-quality102-causal-v1-market-data.ts` and the focused tests.

- Add capped exponential/retry-after handling only for non-mutation requests.
- Load Q102 symbol history and current-hour open through a small worker pool, sequentially per symbol, without fallback candles or look-ahead.
- Keep all existing continuity, current-open, freshness, and fail-closed validations intact.

## Task 4: Run local verification and create auditable commits

- Run focused tests, all V12/PENGU/Q102 self-tests, typechecks, build, and existing strict contracts.
- Run only dry-run/self-test/preflight commands; record real/test/synthetic order counts as zero.
- Commit in logical units: reliability tests/utilities, runner wiring, provider recovery, and verification notes.

## Task 5: Perform controlled VPS rollout and verification

- Capture current service/unit/dependency/state snapshots and confirm zero positions/open orders before any restart.
- Deploy the immutable new release using the repository's release path, repair release-local dependency resolution, and align only the current PENGU dependency drop-in.
- Isolate exact stale crash-loop units after backups; do not broadly stop services or start V52.
- Restart only current V12/PENGU/Q102 and their current shared guard as needed, then verify SHA, process paths, heartbeats, reconciliation, caps, kill switch, account lock, logs, and zero order mutations.
- If any preflight fails, leave the affected strategy fail-closed and report the exact blocker.
