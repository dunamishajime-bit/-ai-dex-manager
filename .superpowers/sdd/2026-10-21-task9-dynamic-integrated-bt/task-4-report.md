# Task 4 Report — Causal Preemption, Partial Exit Boundary, and Dynamic Sizing

## Scope and status

Task 4 was implemented in the research-only worktree on branch
`codex/task9-engine-audit-dd-research-20261020`.

Production, VPS, LIVE, HP, Aster, operator, shared-risk, margin-guard, and
kill-switch paths were not changed. No orders, cancellations, or live
position mutations were performed.

Formal historical preemption parity remains **UNSUPPORTED**. The existing
123/125 figures are retained only as provenance-verified historical
observations; they are not treated as dynamic-engine parity evidence.

## Implementation commits

- Initial Task 4 implementation: `34570f14e52c8f3bccb7719844a8b75cf6ced4e3`
- Review fix round 1: `57239927ef41dea57abeca88811c2e04695b22eb`
- Final targeted implementation/test fixes: `ec86f3b658fe790dbf4c8f865a173d2849f655dd`
- Allocator-integrity fix round: `c7420f91f47f58bd96078d65db01bccfac85c02c`

The final implementation/test commit is `c7420f91f47f58bd96078d65db01bccfac85c02c`.

## Task 4 behavior covered

- Preemption eligibility is derived from authoritative allocator state during
  application, including protected reservation state.
- Victim identity requires an explicit open/filled reservation and matching
  reservation, candidate, strategy, symbol, side, ownership, and positive gross
  values.
- Before any release transition, the complete allocator state is checked for
  finite/non-negative aggregate scalars, gross/pending/reserved maps, valid
  reservation and ownership records, matching aggregate sums, and valid
  ownership indexes. Malformed state is rejected before `releaseReservation`
  and preserves state hashes and release outcome.
- Same-timestamp preemption requires nonempty authoritative event evidence with
  matching `PREEMPTION_EXIT` and `ENTRY` identities/timestamps, unique valid
  nonnegative sequence values, and exit sequence before entry sequence.
- Future exits, missing/reversed/duplicate/unrelated event evidence, partial
  execution, unknown execution, and malformed gross values fail closed without
  allocator mutation.
- Whole preemption uses the Task 3 allocator transitions in lifecycle order:
  victim exit confirmation, gross release, cooldown/ownership update, then
  incoming re-admission.
- Dynamic sizing uses Task 3 `available_margin` semantics without subtracting
  pending gross twice, and applies decision-time wallet/equity, strategy gross,
  margin, cost reserves, quantity step, minimum quantity, minimum notional, and
  exact gross-cap checks.
- A successful irreversible victim release is exposed separately from incoming
  admission through `victim_release_applied` and the
  `VICTIM_RELEASED_INCOMING_REJECTED` lifecycle.

## TDD and verification record

The final targeted regression run was performed after the final code changes:

```text
npx tsx --test tests/dd-reduction-dynamic-preemption.test.ts tests/dd-reduction-dynamic-sizing.test.ts
→ tests 25, pass 25, fail 0, skipped 0, todo 0
```

The full required DD reduction suite was run after the implementation commit
in the permitted elevated environment because the restricted Windows process
launcher can return `spawn EPERM`:

```text
npm run dd:reduction:test
→ DD_REDUCTION_TEST_DISCOVERY files=13
→ DD_REDUCTION_TEST_SUMMARY files=13 passed=13 failed=0 skipped=0 todo=0
```

Additional final checks:

```text
npx tsc --noEmit --incremental false --pretty false
→ exit 0

npx eslint lib/backtest/dd-reduction/dynamic-preemption.ts lib/backtest/dd-reduction/dynamic-sizing.ts tests/dd-reduction-dynamic-preemption.test.ts tests/dd-reduction-dynamic-sizing.test.ts
→ exit 0

git diff --check
→ clean
```

## Historical 123/125 evidence boundary

The observation ledger uses the existing in-tree research report as the
observation source and the existing in-tree research manifest as its immutable
manifest anchor. Both file SHA256 values are verified by the implementation at
runtime. The contract returns `OBSERVED` / `OBSERVATION_ONLY` only when both
digests verify and the observed count matches the cost-specific historical
figure. It always returns `formal_parity_eligible: false`.

This proves provenance for the historical observations only. It does not prove
that the new dynamic preemption implementation reproduces 123 events at 10 bps
or 125 events at 30 bps. Therefore the formal parity result remains
`UNSUPPORTED`.

See [task-4-provenance.json](task-4-provenance.json) for the machine-readable
ledger.
