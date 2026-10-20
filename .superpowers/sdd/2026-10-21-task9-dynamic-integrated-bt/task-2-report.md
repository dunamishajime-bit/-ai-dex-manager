# Task 2 report: deterministic dynamic event ordering and allocator state hash

## Status

Implemented in the research-only worktree on branch `codex/task9-engine-audit-dd-research-20261020`.

The implementation is limited to deterministic ordering, ordering-evidence classification, canonical allocator-state hashing, and replay-time cooldown visibility. Production, VPS, LIVE, HP, Aster, operator-artifact, Shared Risk, Margin Guard, Kill Switch, and generic emulator behavior were not changed.

## Commit

- `feat(research): make dynamic event ordering deterministic`

## TDD evidence

### RED

Command:

```text
node --import tsx --test --test-isolation=none tests/dd-reduction-dynamic-ordering.test.ts
```

Relevant RED output copied verbatim after adding the test before the implementation files:

```text
EXIT=1
✖ tests\dd-reduction-dynamic-ordering.test.ts (0.5795ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 282.3137

✖ failing tests:

✖ tests\dd-reduction-dynamic-ordering.test.ts (0.5795ms)
  Error: Cannot find module '../lib/backtest/dd-reduction/dynamic-ordering'
  Require stack:
  - C:\Users\dis\.codex\worktrees\dd-reduction-sequential-20261019\-ai-dex-manager\tests\dd-reduction-dynamic-ordering.test.ts
      at node:internal/modules/cjs/loader:1448:19
      at Module._resolveFilename (node:internal/modules/cjs/loader:1445:15)
      at nextResolveSimple (file:///C:/Users/dis/.codex/worktrees/dd-reduction-sequential-20261019/-ai-dex-manager/node_modules/tsx/dist/register-B7jrtLTO.mjs:1:789)
      at C:\Users\dis\.codex\worktrees\dd-reduction-sequential-20261019\-ai-dex-manager\node_modules\tsx\dist\register-D46fvsV_.cjs:4:1004
      at C:\Users\dis\.codex\worktrees\dd-reduction-sequential-20261019\-ai-dex-manager\node_modules\tsx\dist\register-D46fvsV_.cjs:3:2630
      at C:\Users\dis\.codex\worktrees\dd-reduction-sequential-20261019\-ai-dex-manager\node_modules\tsx\dist\register-D46fvsV_.cjs:3:1542
      at resolveTsPaths (C:\Users\dis\.codex\worktrees\dd-reduction-sequential-20261019\-ai-dex-manager\node_modules\tsx\dist\register-D46fvsV_.cjs:4:760)
      at Module._resolveFilename (file:///C:/Users/dis/.codex/worktrees/dd-reduction-sequential-20261019/-ai-dex-manager/node_modules/tsx/dist/register-B7jrtLTO.mjs:1:789)
      at nextResolveSimple (file:///C:/Users/dis/.codex/worktrees/dd-reduction-sequential-20261019/-ai-dex-manager/node_modules/tsx/dist/register-B7jrtLTO.mjs:1:789)
      at C:\Users\dis\.codex\worktrees\dd-reduction-sequential-20261019\-ai-dex-manager\node_modules\tsx\dist\register-D46fvsV_.cjs:4:1004
      at C:\Users\dis\.codex\worktrees\dd-reduction-sequential-20261019\-ai-dex-manager\node_modules\tsx\dist\register-D46fvsV_.cjs:3:2630
      at C:\Users\dis\.codex\worktrees\dd-reduction-sequential-20261019\-ai-dex-manager\node_modules\tsx\dist\register-D46fvsV_.cjs:3:1542
      at resolveTsPaths (C:\Users\dis\.codex\worktrees\dd-reduction-sequential-20261019\-ai-dex-manager\node_modules\tsx\dist\register-D46fvsV_.cjs:4:760)
      at Module._resolveFilename (file:///C:/Users/dis/.codex/worktrees/dd-reduction-sequential-20261019/-ai-dex-manager/node_modules/tsx/dist/register-B7jrtLTO.mjs:1:789)
      at nextResolveSimple (node:internal/modules/esm/hooks:748:28)
      at Hooks.resolve (node:internal/modules/esm/hooks:240:30)
      at handleMessage (node:internal/modules/esm/worker:199:24)
      at Immediate.checkForMessages (node:internal/modules/esm/worker:141:28)
      at process.processImmediate (node:internal/timers:491:21) {
    code: 'MODULE_NOT_FOUND',
    requireStack: [ 'C:\\Users\\dis\\.codex\\worktrees\\dd-reduction-sequential-20261019\\-ai-dex-manager\\tests\\dd-reduction-dynamic-ordering.test.ts' ]
  }
```

The first sandboxed attempts were blocked by Windows `EPERM` while spawning the bundled esbuild worker; the escalated invocation above reached the expected missing-module RED state.

### GREEN

Focused regression command:

```text
node --import tsx --test --test-isolation=none tests/dd-reduction-dynamic-ordering.test.ts
```

Exact result:

```text
EXIT=0
✔ orders same-timestamp events by authoritative event_seq before input order (1.5592ms)
✔ uses priority, rank, and candidate ID as a deterministic noncanonical fallback (0.2127ms)
✔ keeps unresolved same-timestamp STOP and ENTRY precedence fail-closed (0.2328ms)
✔ hashes equivalent allocator state objects canonically while preserving array order (0.5019ms)
✔ does not let a future STOP create cooldown for an earlier candidate decision (0.179ms)
ℹ tests 5
ℹ suites 0
ℹ pass 5
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 262.7679
```

## Files changed

- `lib/backtest/dd-reduction/dynamic-ordering.ts`
  - Pure copy-and-sort ordering for candidate/lifecycle-shaped events.
  - Same-timestamp ordering precedence: explicit `event_seq`, event phase, explicit `priority`, explicit `rank`, then stable candidate/event/kind/content tie-break.
  - Spec phase order covers Deposit/Funding through State Hash.
  - `classifyOrderingEvidence` returns canonical/noncanonical status, reasons, and formal-parity eligibility.
- `lib/backtest/dd-reduction/dynamic-state.ts`
  - Recursive canonical JSON normalization with sorted object keys, preserved array order, `-0` normalization, and safe `null` normalization for non-finite numbers.
  - UTF-8 SHA-256 `hashAllocatorState`.
  - `isCooldownActiveAt`, which ignores a stop/exit event whose timestamp is after the candidate decision timestamp.
- `tests/dd-reduction-dynamic-ordering.test.ts`
  - Five direct fixtures covering sequence authority, fallback determinism, unresolved STOP/ENTRY ordering, state-hash determinism, and future-STOP isolation.
  - Includes the repository-required direct fixture identity assertion.
- `.superpowers/sdd/2026-10-21-task9-dynamic-integrated-bt/task-2-report.md`

Existing unrelated worktree changes were preserved and not staged.

## Determinism evidence

- Reversing input order for explicitly sequenced same-timestamp events produces the sequence-defined order.
- Missing `event_seq` still produces a deterministic result using phase, priority, rank, and candidate ID/content tie-breaks, but returns `NONCANONICAL_ORDERING` and `formalParityEligible: false`.
- Same-timestamp STOP/ENTRY events without authoritative sequence evidence are retained, sorted using the documented fallback, and marked with `SAME_TIMESTAMP_ORDER_UNVERIFIABLE`; no favorable ordering is presented as formal parity.
- Equivalent state objects with different object-key insertion orders, `-0`, `Infinity`, and `NaN` produce the same SHA-256 hash; changing array order changes the hash.
- A future STOP cannot make an earlier candidate decision observe a cooldown.

## Verification

Type checking:

```text
npx tsc --noEmit --incremental false
EXIT=0
```

Targeted lint:

```text
npx eslint lib/backtest/dd-reduction/dynamic-ordering.ts lib/backtest/dd-reduction/dynamic-state.ts tests/dd-reduction-dynamic-ordering.test.ts
EXIT=0
```

Full DD-reduction suite:

```text
npm run dd:reduction:test
EXIT=0
> dis-dex-manager@0.1.0 dd:reduction:test
> tsx scripts/dd-reduction/run-tests.mjs

DD_REDUCTION_TEST_DISCOVERY files=10
DD_REDUCTION_TEST_SUMMARY files=10 passed=10 failed=0 skipped=0 todo=0
```

The repository's default `npx tsc --noEmit` attempted to write `tsconfig.tsbuildinfo` and was blocked by the managed worktree's file permissions (`TS5033`/`EPERM`). The no-incremental command above completed successfully without writing that cache file.

## Limitations and concerns

- This task intentionally does not integrate the ordering result into a future allocator/reducer; that is Task 3+ scope.
- Missing `event_seq` is never promoted to production-canonical evidence, even when the fallback ordering is fully deterministic.
- For unresolved same-timestamp STOP/ENTRY events, the implementation preserves all events and produces a deterministic display/replay order, but formal parity remains ineligible.
- Canonical hashing is for caller-supplied allocator state only; it does not read runtime files or secret material and is not a general cyclic-object serializer.

## Review hardening follow-up

The review fix is implemented in the same research-only boundary.

### RED

Command:

```text
node --import tsx --test --test-isolation=none tests/dd-reduction-dynamic-ordering.test.ts
```

Before the fix, the new tests produced:

```text
EXIT=1
ℹ tests 8
ℹ pass 5
ℹ fail 3

✖ rejects negative and fractional event_seq values at the ordering evidence boundary
  actual: CANONICAL_ORDERING
  expected: NONCANONICAL_ORDERING
✖ rejects duplicate event_seq values within one same-timestamp stream
  actual: CANONICAL_ORDERING
  expected: NONCANONICAL_ORDERING
✖ uses locale-independent UTF-16 code-unit ordering for tie-breaks
  actual: ["ä", "z"]
  expected: ["z", "ä"]
```

### Fix

- The exported classifier now validates `event_seq` as a non-negative integer and emits `INVALID_EVENT_SEQUENCE` for negative, fractional, `NaN`, infinite, or otherwise malformed values.
- Same-timestamp valid sequence collisions emit `DUPLICATE_EVENT_SEQUENCE`; fallback sorting cannot promote a collision to canonical evidence.
- Sequence evidence classification distinguishes invalid, duplicate, and missing sequence reasons while always setting `formalParityEligible` to false for those cases.
- The source-normalization integration fixture confirms normalized valid sequences remain intact and duplicate same-timestamp sequences are classified noncanonical by the exported boundary. Existing source normalization continues to fail-close malformed negative/fractional sequences.
- The tie-break now compares UTF-16 code units explicitly and does not depend on locale data or `localeCompare`.

### GREEN

Focused ordering result:

```text
EXIT=0
ℹ tests 8
ℹ pass 8
ℹ fail 0
```

Focused ordering plus source integration result:

```text
EXIT=0
ℹ tests 27
ℹ pass 27
ℹ fail 0
```

Final full-suite result:

```text
EXIT=0
DD_REDUCTION_TEST_DISCOVERY files=10
DD_REDUCTION_TEST_SUMMARY files=10 passed=10 failed=0 skipped=0 todo=0
```

Final type check and lint both exited `0`:

```text
npx tsc --noEmit --incremental false
npx eslint lib/backtest/dd-reduction/dynamic-ordering.ts lib/backtest/dd-reduction/dynamic-state.ts tests/dd-reduction-dynamic-ordering.test.ts tests/dd-reduction-dynamic-source.test.ts
```
