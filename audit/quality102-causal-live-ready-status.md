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
- Exact recovered S34 post-generation quality gates for PB/MR/BRK/REV.
- Exact recovered S1 > S2 > S3 > S4 one-slot routing semantics.
- Compile-time capability state separated from caller/operator manifest data.
- Independent `liveArmed` input that cannot override missing implementation.
- Existing `disdex-quality102-live-selector` routed through the causal readiness boundary.
- Strict portfolio risk constants remain unchanged and are asserted by self-test.
- Dedicated GitHub Actions causal-readiness workflow.

## Provenance blocker

The original causal S34 PB/MR/BRK/REV raw generator that produced the historical `latest_stage34.csv`, `latest_core.csv`, and `latest_filler.csv` inputs has not been recovered from the inspected GitHub history or source run artifact.

The frozen 102 rows and variant names are not treated as sufficient evidence to infer those formulas. The repository therefore exposes `QUALITY102_S34_RAW_GENERATOR_NOT_AVAILABLE` and keeps the executable capability flags false.

## Machine-readable state

```text
S34_RAW_GENERATOR_PROVEN=false
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

1. authoritative causal S34 raw-generator implementation/provenance;
2. no-lookahead proof using only data available at each decision timestamp;
3. raw/oracle parity evidence for the recovered research population;
4. expected 151 raw -> 124 quality -> 102 one-slot flow;
5. expected final layer counts S1=8, S2=10, S3=69, S4=15;
6. 102/102 frozen identity and numeric parity within the accepted tolerance;
7. regression, strict planner, account-lock, gross, reconciliation and fail-closed CI gates;
8. a separate explicit LIVE-arm/runtime migration.

No configuration flag in this branch is permitted to substitute for missing source code or provenance.