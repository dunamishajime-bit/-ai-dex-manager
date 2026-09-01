# Quality102 causal LIVE readiness implementation plan

> Scope: prepare Quality102 for causal LIVE integration without inventing the missing S34 raw generator. All unresolved provenance remains fail-closed. No VPS changes, LIVE activation, or orders are in scope.

## Goal

Build a typed, testable causal-selector boundary that can accept a proven dynamic Quality102 generator later, while implementing every exact component that is already recoverable from frozen research evidence.

The implementation must preserve the strict portfolio controls already present on the base branch:

- Quality102 gross cap: 0.50x
- Crypto gross cap including Quality102: 2.00x
- Total gross cap: 2.50x
- Priority: V52 > PENGU > V12 > Quality102
- shared account lock / reconciliation / kill switch / order protection remain unchanged

## Proven vs. missing logic

### Proven and safe to implement

1. Source identity must match strict BT run `33404708902` / SHA `aec066fefd761b12f07e6927b5f2a524f88ca08b`.
2. Frozen historical CSV signals are research evidence only and can never be a LIVE provider.
3. Decision data must be available no later than the decision timestamp.
4. S34 post-generation quality gates recovered from commit `450f8fae800d3f509ef868ab035f0cd731216279`:
   - PB: reject only `PB168_0.1_P24_0.04_H12`.
   - MR: short unchanged; long requires prior-14d open/open return >= -2.5%.
   - BRK: `strength >= 0.03` and `side * ret14 >= -0.05`.
   - REV: unchanged.
5. Layer priority: S1 > S2 > S3 > S4.
6. Quality102 is one-slot: candidates arriving before the active candidate exits are blocked.
7. Unknown families, invalid sides, non-finite required fields, stale/future/missing data, or missing provenance fail closed.

### Not proven and therefore not to be invented

The causal PB/MR/BRK/REV S34 *raw candidate generator* that originally produced `latest_stage34.csv` / `latest_core.csv` / `latest_filler.csv` is not present in the inspected GitHub history or source run artifact. Variant names and frozen output rows are not sufficient evidence to reconstruct its formulas.

Until an authoritative implementation/provenance source is recovered, the S34 provider reports `QUALITY102_S34_RAW_GENERATOR_NOT_AVAILABLE` and Quality102 cannot arm for LIVE.

## Safety state machine

Two independent gates are required:

- `selectorImplemented`: true only when every required raw generator, including S34, has executable provenance-backed code.
- `liveArmed`: an explicit runtime/operator arm. Implementation readiness alone must never place orders.

Readiness requires all of the following:

- dynamic source kind
- exact strict source identity
- no-lookahead proof
- selector-parity proof
- fixed historical timestamps = false
- data available at decision time
- data freshness within the configured maximum age
- raw S34 generator proven
- selector implemented
- LIVE explicitly armed

Any failed condition returns `LIVE_BLOCKED_FAIL_CLOSED`.

## TDD sequence

### Task 1 — RED: causal contract tests

Add `scripts/disdex-quality102-causal-selector-selftest.ts` before the implementation module. Tests cover:

- missing provenance
- future decision data
- stale decision data
- frozen historical provider
- missing S34 generator proof
- selector not implemented
- LIVE not armed
- unknown S34 family
- invalid side / non-finite strength or ret14
- exact PB/MR/BRK/REV quality gates
- exact S1>S2>S3>S4 one-slot priority
- occupied one-slot blocking
- strict gross constants remain 0.50 / 2.00 / 2.50

The first CI run is expected to fail because the causal implementation module does not exist yet.

### Task 2 — GREEN: causal boundary implementation

Add `lib/disdex-quality102-causal-selector.ts` containing only proven logic:

- typed provenance manifest and decision context
- readiness evaluator
- S34 quality-gate evaluator
- deterministic one-slot router
- explicit missing-generator result
- no execution/order side effects

Do not implement or infer PB/MR/BRK/REV raw signal equations.

### Task 3 — integrate existing LIVE selector

Refactor `lib/disdex-quality102-live-selector.ts` to delegate proof/readiness evaluation to the causal boundary while preserving existing reason codes where practical. The result must remain blocked with current repository state because S34 is unproven and `liveArmed=false`.

### Task 4 — CI and package entry points

Add:

- `strategy:strict-bt33404708902:causal-selector:selftest`
- `.github/workflows/quality102-causal-live-ready.yml`

CI runs:

1. causal selector self-test
2. legacy Quality102 LIVE selector self-test
3. strict gross self-test
4. strict contract test
5. TypeScript typecheck

### Task 5 — audit status

Add `audit/quality102-causal-live-ready-status.md` with machine-readable final state. Unless the missing S34 producer is independently recovered and proven in this branch, final state must remain:

```text
S34_RAW_GENERATOR_PROVEN=false
QUALITY102_SELECTOR_IMPLEMENTED=false
QUALITY102_LIVE_ARMED=false
QUALITY102_LIVE=FAIL_CLOSED
VPS_CHANGED=false
LIVE_ACTIVATED=false
ORDERS_SENT=0
```

## Acceptance criteria

The branch is considered *implementation-ready but not LIVE-ready* when:

- causal contracts exist and pass,
- exact recovered S34 post-generation quality rules and one-slot routing are implemented,
- strict risk constants are unchanged,
- legacy selector remains fail-closed,
- CI passes,
- no VPS or order path has been touched,
- missing raw generator is represented as an explicit typed blocker rather than guessed code.

Full Quality102 LIVE readiness additionally requires authoritative S34 raw-generator recovery plus oracle/parity evidence (151 raw -> 124 quality -> 102 one-slot, including S1=8, S2=10, S3=69, S4=15 and 102/102 identity). That later proof is a separate gate, not something this plan fabricates.