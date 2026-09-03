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
- Pure `disdex-quality102-causal-pipeline` implementation: completed-1H features, Wilder RSI/ATR, HIGH_VOL raw grid, preceding-180-day eligibility/Wilson ranking, next-hour entry, hard-stop/+12%-then-5%-trailing/72h exits, research cost accounting, S34 post-generation gates/classification, and Quality124→Quality102 one-slot routing.
- Exact recovered S34 post-generation quality gates for PB/MR/BRK/REV.
- Exact recovered S1 > S2 > S3 > S4 one-slot routing semantics.
- Focused synthetic contract reproduces `151 → 124 → 102`, `22` one-slot blocks, and final `S1/S2/S3/S4 = 8/10/69/15` without using frozen timestamps as runtime input.
- Granular recovery capability ledger separates recovered code/evidence from unresolved causal links.
- Existing `disdex-quality102-live-selector` remains behind causal readiness and cannot be armed through manifest/operator self-attestation.
- Strict portfolio risk constants remain unchanged and are asserted by self-test.

## Recovery evidence now pinned

### HIGH_VOL

The HIGH_VOL raw-grid implementation is present. Prior reconstruction evidence recovered during this branch investigation recorded exact raw-grid containment/parity for:

- old universe: `137/137`;
- expanded universe: `388/388`;
- combined expected raw population: `525`.

This evidence is recorded as recovery bookkeeping only. It is deliberately **not** treated as proof of the missing `525 → 30` selection/linkage because the repository does not contain an authoritative original selector or a repository fixture that derives the exact thirty pre-one-slot S1/S2 rows from those 525 raw candidates.

The recovered pre-one-slot HIGH_VOL shape is `S1=8`, `S2=22`, total `30`; the final one-slot output contains `S1=8`, `S2=10`.

Historical reconstruction commit `1243963a3825100fb4896659db946f2f5e245480` explicitly declares `ORIGINAL_RAW_GENERATOR_PROVEN = False` and states that S1/S2 assignment/monthly selection scope is not proven. Workflow commit `a8967f24652704e7a148729517b3cad4a9ab0026` likewise prints `ORIGINAL_RAW_GENERATOR_PROVEN=FALSE` / `RESEARCH_ONLY=TRUE`. These reconstructed studies therefore cannot be promoted into authoritative selector provenance.

### S34 / BRK

Commit `450f8fae800d3f509ef868ab035f0cd731216279` proves downstream S34 transforms from already-materialized inputs, including the BRK gate `strength >= 0.03` plus the directional `ret14` condition. It does **not** generate BRK `strength` from OHLCV.

Recovered 2026-08-29 research outputs show that the same symbol/timestamp can carry the same BRK `strength` across different BRK variants, strongly indicating that `strength` is an upstream symbol/time feature rather than a variant-specific post-processing value. That observation narrows the search but is not an authoritative formula, so no inferred formula is used in production code.

PB/MR/REV post-generation behavior is recovered. The complete S34 causal producer remains fail-closed because upstream BRK `strength` is still unproven.

### Frozen 102 lineage

Commit `8716b97ef0a25894daf3d22ad60edcd258d6591c` first embeds the Quality102 candidate payload as gzip+base64, validates SHA-256 `b45f492a67307cf1845fcce6af0919c5202a5853b13e7f0914daf11889bd5ead`, writes `.research-state/quality102-frozen.csv`, and supplies it through `--supplement-csv`. It does not contain the upstream generator.

Runs `33257164125` and `33404708902` therefore validate integration/BT behavior of the frozen/recovered candidate set, not causal OHLCV regeneration of the original 102.

## Current provenance blockers

Only the following two causal links are treated as the first-class unresolved blockers:

1. **HIGH_VOL `525 → 30` exact selector** — authoritative rule/linkage that produces the exact pre-one-slot `S1=8/S2=22` population from the recovered 525 raw candidates;
2. **BRK `strength` OHLCV formula** — authoritative upstream calculation that reproduces the observed BRK strength values causally.

The code reports the first unresolved boundary as `HIGH_VOL_525_TO_30_SELECTOR_PROOF_MISSING`. If that link is later proven, readiness must next fail on `BRK_STRENGTH_FORMULA_PROOF_MISSING` until the second link is independently proven.

No fixed 102 CSV, recovered output identity, variant name, manual ID list, or operator flag is accepted as a substitute for either proof.

## Machine-readable state

```text
HIGH_VOL_RAW_GENERATOR_IMPLEMENTED=true
HIGH_VOL_OLD_UNIVERSE_RECOVERED_PARITY=137/137
HIGH_VOL_EXPANDED_UNIVERSE_RECOVERED_PARITY=388/388
HIGH_VOL_COMBINED_RAW_EXPECTED=525
HIGH_VOL_525_TO_30_SELECTOR_PROVEN=false
HIGH_VOL_RECOVERED_PRE_ONE_SLOT=S1:8,S2:22,TOTAL:30
PB_MR_REV_POST_GENERATION_RECOVERED=true
BRK_STRENGTH_FORMULA_PROVEN=false
QUALITY124_TRANSFORM_RECOVERED=true
ONE_SLOT_ROUTER_RECOVERED=true
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
TEST_ORDERS=0
ARTIFICIAL_LIVE_ORDERS=0
```

## Full-LIVE unlock requirements

Quality102 must remain blocked until a later commit contains all of the following independent evidence:

1. exact causal HIGH_VOL `525 → 30` selector implementation and provenance;
2. exact causal BRK `strength` OHLCV implementation and provenance;
3. no-lookahead proof using only data available at each decision timestamp;
4. raw/oracle parity for the complete reconstructed population;
5. exact `151 raw → 124 quality → 102 one-slot` flow;
6. exact final layer counts `S1=8, S2=10, S3=69, S4=15`;
7. 102/102 frozen identity and numeric parity within accepted tolerance;
8. regression, strict planner, account-lock, gross, reconciliation and fail-closed CI gates;
9. separate explicit LIVE-arm/runtime migration after all prior gates pass.

Remote desktop/local-clone reflog and dangling-object recovery remains a useful additional evidence source when the authorized desktop is online, but LIVE readiness does not depend on pretending that unavailable evidence exists.

No configuration flag in this branch is permitted to substitute for missing source code or provenance.
