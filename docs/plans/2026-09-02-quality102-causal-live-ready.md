# Quality102 causal LIVE readiness implementation plan

> Scope: prepare Quality102 for causal LIVE integration without inventing either missing raw-entry generator. All unresolved provenance remains fail-closed. No VPS changes, LIVE activation, or orders are in scope.

## Goal

Build a typed, testable causal-selector boundary that can accept proven dynamic Quality102 generators later, while implementing every exact component already recoverable from frozen research evidence.

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
4. The recovered research code can transform already-materialized HIGH_VOL rows and contains the known 72h / trigger12 / trail5 / hard-stop semantics.
5. S34 post-generation quality gates recovered from commit `450f8fae800d3f509ef868ab035f0cd731216279`:
   - PB: reject only `PB168_0.1_P24_0.04_H12`.
   - MR: short unchanged; long requires prior-14d open/open return >= -2.5%.
   - BRK: `strength >= 0.03` and `side * ret14 >= -0.05`.
   - REV: unchanged.
6. Layer priority: S1 > S2 > S3 > S4.
7. Quality102 is one-slot: candidates arriving before the active candidate exits are blocked.
8. Unknown families, invalid sides, non-finite required fields, stale/future/missing data, or missing provenance fail closed.

### Not proven and therefore not to be invented

The inspected GitHub history and source-run artifact do not contain authoritative causal source for either raw-entry population:

- S1/S2 HIGH_VOL raw-entry generator -> `latest_stage1.csv` / `latest_stage2.csv`;
- S3/S4 PB/MR/BRK/REV raw generator -> `latest_stage34.csv` / `latest_core.csv` / `latest_filler.csv`.

Commit `450f8fa...` consumes these files after they already exist; it does not establish their causal generation formulas. Frozen rows and variant names are not sufficient evidence to reconstruct those formulas.

Until authoritative implementations/provenance are recovered, the providers report `QUALITY102_S1S2_RAW_GENERATOR_NOT_AVAILABLE` and `QUALITY102_S34_RAW_GENERATOR_NOT_AVAILABLE`, and Quality102 cannot arm for LIVE.

## Safety state machine

Independent gates are required:

- `s1s2RawGeneratorProven`: true only when the S1/S2 raw-entry producer exists with authoritative provenance/parity evidence.
- `s34RawGeneratorProven`: true only when the S3/S4 raw producer exists with authoritative provenance/parity evidence.
- `selectorImplemented`: true only when every required raw generator and downstream causal selector path is executable and proven.
- `liveArmed`: explicit runtime/operator arm. Implementation readiness alone must never place orders.

Readiness requires all of the following:

- dynamic source kind
- exact strict source identity
- no-lookahead proof
- selector-parity proof
- fixed historical timestamps = false
- data available at decision time
- data freshness within the configured maximum age
- S1/S2 raw generator proven
- S3/S4 raw generator proven
- selector implemented
- LIVE explicitly armed

Any failed condition returns `LIVE_BLOCKED_FAIL_CLOSED`.

## TDD sequence

### Task 1 — RED: causal contract tests

Add `scripts/disdex-quality102-causal-selector-selftest.ts` before the implementation module. Tests cover missing provenance, frozen/future/stale data, no-lookahead/parity/source identity, both missing raw-generator proofs, exact recovered S34 quality gates, deterministic one-slot priority, and unchanged strict gross constants.

The first CI run is expected to fail because the causal implementation module does not exist yet.

### Task 2 — GREEN: causal boundary implementation

Add `lib/disdex-quality102-causal-selector.ts` containing only proven logic:

- typed provenance manifest and decision context
- readiness evaluator
- separate raw-generator capability blockers
- S34 quality-gate evaluator
- deterministic one-slot router
- no execution/order side effects

Do not implement or infer missing S1/S2 or S3/S4 raw signal equations.

### Task 3 — integrate existing LIVE selector

Refactor `lib/disdex-quality102-live-selector.ts` to delegate proof/readiness evaluation to the causal boundary while preserving existing reason codes where practical. Current repository state must remain blocked even if an operator supplies `liveArmed=true`.

### Task 4 — CI and package entry points

Add `strategy:strict-bt33404708902:causal-selector:selftest` and `.github/workflows/quality102-causal-live-ready.yml`.

CI runs causal selector self-test, legacy selector fail-closed self-test, strict gross self-test, strict contract and TypeScript typecheck.

### Task 5 — audit status

Unless both raw producers are independently recovered and proven in this branch, final state must remain:

```text
S1S2_RAW_GENERATOR_PROVEN=false
S34_RAW_GENERATOR_PROVEN=false
QUALITY102_SELECTOR_IMPLEMENTED=false
QUALITY102_LIVE_ARMED=false
QUALITY102_LIVE=FAIL_CLOSED
VPS_CHANGED=false
LIVE_ACTIVATED=false
ORDERS_SENT=0
```

## Acceptance criteria

The branch is considered implementation-ready but not LIVE-ready when causal contracts pass, all exactly recovered downstream rules are implemented, strict risk constants remain unchanged, legacy selector stays fail-closed, CI passes, no VPS/order path is touched, and every missing raw generator is an explicit typed blocker rather than guessed code.

Full Quality102 LIVE readiness additionally requires authoritative recovery of both raw-entry producers plus oracle/parity evidence for the expected 151 raw -> 124 quality -> 102 one-slot flow, final layer counts S1=8, S2=10, S3=69, S4=15, and 102/102 identity. That later proof is a separate gate, not something this plan fabricates.