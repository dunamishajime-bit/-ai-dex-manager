# Quality102 causal LIVE readiness status

Branch: `codex/quality102-causal-live-ready-20260902`
Base strict SHA: `343c25a4daf25306ae08fbb5e70d338f016b17ea`
Strict BT source run: `33404708902`
Strict BT source SHA: `aec066fefd761b12f07e6927b5f2a524f88ca08b`
Recovered post-generation selector source: `450f8fae800d3f509ef868ab035f0cd731216279`

## Implemented in this branch

- Typed causal provenance/readiness boundary.
- Frozen historical provider prohibition.
- no-lookahead, source identity, decision-time availability and stale-data fail-closed gates.
- Separate compile-time proof gates for the S1/S2 HIGH_VOL raw-entry generator and S3/S4 S34 raw generator.
- Exact recovered S34 post-generation quality gates for PB/MR/BRK/REV.
- Exact recovered S1 > S2 > S3 > S4 one-slot routing semantics.
- Compile-time capability state separated from caller/operator manifest data.
- Independent `liveArmed` input that cannot override missing implementation.
- Existing `disdex-quality102-live-selector` routed through the causal readiness boundary.
- Pure `disdex-quality102-causal-pipeline` implementation: completed-1H features, Wilder RSI/ATR, HIGH_VOL grid matching, monthly rule eligibility/Wilson ranking, next-hour entry, hard-stop/trailing/72h exits, research cost accounting, explicit stage-subset validation, S34 gate/classification, and Quality124→Quality102 one-slot routing.
- Focused synthetic contract reproduces the required shape `151 → 124 → 102`, `22` one-slot blocks, and `S1/S2/S3/S4 = 8/10/69/15` without using frozen timestamps as runtime input.
- Strict portfolio risk constants remain unchanged and are asserted by self-test.
- Dedicated GitHub Actions causal-readiness workflow runs the pipeline self-test.

## Provenance blockers

Two causal raw-entry producers remain unproven in the inspected repository/history/source artifact:

1. the S1/S2 HIGH_VOL raw-entry generator that originally produced `latest_stage1.csv` / `latest_stage2.csv`;
2. the S3/S4 PB/MR/BRK/REV raw generator that originally produced `latest_stage34.csv` / `latest_core.csv` / `latest_filler.csv`.

Commit `450f8fae800d3f509ef868ab035f0cd731216279` proves downstream transforms/quality gates/one-slot reconstruction from those already-materialized inputs; it does not prove how either raw candidate population was causally generated.

Frozen rows, output CSVs and variant names are not treated as sufficient evidence to infer raw signal formulas. The pipeline therefore requires explicit S1/S2 stage membership and a finite upstream S34 `strength` value; it does not synthesize either missing provenance or the BRK strength formula. The repository exposes both `QUALITY102_S1S2_RAW_GENERATOR_NOT_AVAILABLE` and `QUALITY102_S34_RAW_GENERATOR_NOT_AVAILABLE`, and keeps LIVE capability flags false.

## Machine-readable state

```text
S1S2_RAW_GENERATOR_PROVEN=false
S34_RAW_GENERATOR_PROVEN=false
QUALITY102_CAUSAL_PIPELINE_IMPLEMENTED=true
QUALITY102_SELECTOR_IMPLEMENTED=false
QUALITY102_LIVE_ARMED=false
QUALITY102_LIVE=FAIL_CLOSED
QUALITY102_POSITION_CAP=0.50x
CRYPTO_GROSS_CAP=2.00x
TOTAL_GROSS_CAP=2.50x
VPS_CHANGED=false
LIVE_ACTIVATED=false
ORDERS_SENT=0
ARTIFICIAL_LIVE_ORDERS=0
```

## Full-LIVE unlock requirements

Quality102 must remain blocked until a later commit contains all of the following independent evidence:

1. authoritative causal S1/S2 HIGH_VOL raw-entry generator implementation/provenance;
2. authoritative causal S3/S4 S34 raw-generator implementation/provenance;
3. no-lookahead proof using only data available at each decision timestamp;
4. raw/oracle parity evidence for the recovered research population;
5. expected 151 raw -> 124 quality -> 102 one-slot flow;
6. expected final layer counts S1=8, S2=10, S3=69, S4=15;
7. 102/102 frozen identity and numeric parity within the accepted tolerance;
8. regression, strict planner, account-lock, gross, reconciliation and fail-closed CI gates;
9. a separate explicit LIVE-arm/runtime migration.

No configuration flag in this branch is permitted to substitute for missing source code or provenance.
