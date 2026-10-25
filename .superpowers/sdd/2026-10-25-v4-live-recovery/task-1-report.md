# Task 1 report — V4 recoverable-failure boundaries

## Scope and baseline

- Worktree: `C:\Users\dis\-ai-dex-manager\.worktrees\v4-sha-bound-time37-no-flat-crash-20261025`
- Supplied repair-branch base: `6f0ecd7f8f8f0f99b9414ff6f827087dc46c13c6`
- VPS/LIVE state was out of scope and was not accessed.

## Files changed

- `lib/v12-v4-runner-engine.ts`
  - Added exact `V4_ACCOUNT_LEASE_RENEWAL_FAILED` classification as a `BLOCKED` result with `orderEnabled=false` and a 15,000 ms retry bound.
  - Added pure startup market-data failure classification. Network reset/timeout/DNS/HTTP 5xx/429 failures become bounded fail-closed results; existing Aster rate-budget failures remain observing/deferred; known V4 market-data warmup failures preserve their existing observing result; unknown configuration, credential, approval, state-integrity, risk, and other failures remain unclassified so the runner can fail closed.
  - Wired the classifier into both prefetch reuse and in-lease decision reads. Added optional `retryAfterMs` to the tick result contract.
- `scripts/v12-v4-production-runner.ts`
  - Converts lease-renewal failures into a retryable blocked daemon result.
  - Carries bounded retry timing from tick results.
  - Added `classifyV4HealthSafetyState` and wired health output so explicit V4 preparation, market-data, exit-feed, stale-review, and lease-degraded reasons cannot publish `HEALTHY`; flat `NO_NATIVE_ENTRY_CANDIDATES` remains healthy and rate-budget deferral remains `DEFERRED_FAIL_CLOSED`.
- `tests/v12-v4-runner-engine.test.ts`
  - Added RED/GREEN tests for lease renewal and startup exchange-read classification, including fatal/unknown non-reclassification.
- `tests/v12-v4-rate-budget-resilience.test.ts`
  - Added RED/GREEN health-state tests for bare and qualified blocked/degraded reasons.

## RED evidence

After dependencies were available, the narrow command was:

```text
node node_modules/tsx/dist/cli.mjs --test tests/v12-v4-runner-engine.test.ts tests/v12-v4-rate-budget-resilience.test.ts
```

RED result: 29 tests ran, 26 passed, 3 failed. The failures were the newly added contracts calling missing exports: `classifyV4HealthSafetyState`, `classifyV4AccountLeaseRenewalFailure`, and `classifyV4MarketDataReadFailure`.

The initial attempt before dependency installation was infrastructure-only (`dotenv/config` and `viem/accounts` could not be resolved), and the sandbox-only attempt was blocked by Node test-worker `EPERM`; neither was counted as the TDD RED.

## Implementation decisions

1. Kept the public surface to pure classifiers and the existing runner/engine result contract. No VPS, systemd, approval, or production-state path was changed.
2. Recognized only the exact lease-renewal failure reason. Unknown lock/lease errors remain fatal rather than being silently downgraded.
3. Kept flat rate-budget contention observing/deferred and protected/unresolved rate-budget contention blocked, preserving the existing durable-state distinction.
4. Preserved exact-SHA TIME37 approval validation, the LONG `entry*0.92` and SHORT `entry*1.08` stop math, shared risk/margin guards, resident STOP checks, and the existing fatal-risk/systemd policy.
5. Health classification uses only the existing `HEALTHY`, `BLOCKED`, and `DEFERRED_FAIL_CLOSED` vocabulary.

## Focused GREEN evidence

The focused recovery set passed:

```text
node node_modules/tsx/dist/cli.mjs --test tests/v12-v4-rate-budget-resilience.test.ts tests/v12-v4-runner-engine.test.ts tests/v12-v4-time-stop-approval.test.ts tests/v12-v4-recoverable-exit-feed-gap.test.ts tests/v12-v4-lock-minimal-critical-section.test.ts tests/v12-v4-monitor-coherence.test.ts
```

Result: `62` tests passed, `0` failed.

The complete local V4 test glob also passed:

```text
node node_modules/tsx/dist/cli.mjs --test tests/v12-v4-*.test.ts
```

Result: `236` tests passed, `0` failed across `54` files.

The repository-wide TypeScript check was also run. It exited `2` on pre-existing dependency/project diagnostics (`lucide-react` resolution and `viem` `Timer`/type diagnostics); it reported `0` diagnostics in the changed V4 engine, production runner, or V4 test files.

## Remaining concerns

- The repository-wide TypeScript check remains red because the isolated dependency tree/project baseline lacks resolvable `lucide-react` declarations and has existing `viem` type diagnostics. This was not repaired because it is outside Task 1's allowed scope.
- No VPS, LIVE process, production symlink, order state, approval file, or approval artifact was inspected or changed. This report therefore contains no VPS/LIVE verification claim.

## Explicit safety statement

No VPS or approval artifact was changed. No deployment, order, cancel, position, STOP, durable production-state, or operator-approval mutation was performed.
