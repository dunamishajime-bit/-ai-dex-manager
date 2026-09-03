# Quality102 2026-08-29 lineage and artifact inspection

Branch: `codex/quality102-causal-live-ready-20260902`
Inspection date: `2026-09-04`

## Purpose

This note pins the strongest currently recoverable evidence around the missing Quality102 causal links. It does **not** relax LIVE gates and does **not** convert output-level reconstruction into causal provenance.

The unresolved links remain:

1. HIGH_VOL exact `525 -> 30` pre-one-slot selector (`S1=8`, `S2=22` before one-slot routing);
2. BRK upstream `strength` formula from decision-time OHLCV/features.

## Direct re-inspection of Run 33257164125 artifact

GitHub Actions Run `33257164125` still exposes one non-expired artifact:

- artifact id: `9716180325`
- artifact name: `latest-v12-pengu-v8-v52-dca-1y-33257164125`
- artifact digest: `sha256:60a61d34e61119656bb144f7de63045445e1c4315d33db1311fc338d43fc6526`
- source branch: `research/latest-v12-pengu-v8-v52-dca-1y-20260828`
- source SHA: `8716b97ef0a25894daf3d22ad60edcd258d6591c`
- artifact created: `2026-08-29T14:18:45Z`

The ZIP was downloaded and expanded again during this audit. It contains exactly these seven files:

```text
combined-dca.log
monthly-normal.csv
pengu-v8-ledger.json
pengu-v8.log
report.md
result.json
v12-top2-ledger.json
```

It does **not** contain any of the following provenance material:

```text
latest_stage1.csv
latest_stage2.csv
latest_stage34.csv
quality_one_slot_candidate.csv
*.py
*.ipynb
raw HIGH_VOL candidate generator
HIGH_VOL 525 -> 30 selector source
BRK strength producer source
```

A recursive text scan of the expanded artifact likewise found no selector/generator/strength implementation. The Quality102-specific research metadata retained in `result.json` is only:

```text
strategy=SUPPLEMENT_QUALITY102
grossCap=0.15
entryPolicy=BASE_IDLE_ONLY_ONE_SLOT_NO_PREEMPT
frozenCandidateCount=102
```

The report itself labels the run `Research only` and states that no LIVE order, VPS mutation, or production change was performed.

**Conclusion:** Run `33257164125` is a frozen-candidate consumer/integration BT artifact. It cannot prove the upstream causal generator.

## First frozen-payload bridge

Commit `8716b97ef0a25894daf3d22ad60edcd258d6591c` is the first directly verified bridge that embeds the Quality102 payload as gzip+base64, validates candidate SHA-256

```text
b45f492a67307cf1845fcce6af0919c5202a5853b13e7f0914daf11889bd5ead
```

writes it to `.research-state/quality102-frozen.csv`, and passes it to the BT through `--supplement-csv`.

That commit is therefore downstream of candidate generation. It is not the missing selector source.

## Explicit reconstruction boundaries already present in Git history

### HIGH_VOL reconstruction commit

Commit `1243963a3825100fb4896659db946f2f5e245480` (`research: implement fail-closed S1 S2 raw-grid reconstruction`) explicitly contains:

```text
RESEARCH_ONLY = True
ORIGINAL_RAW_GENERATOR_PROVEN = False
```

Its own comments state that it reconstructs the documented raw-grid containment contract and deliberately does not claim the missing original generator, S1/S2 assignment, or monthly selection scope.

Therefore exact recovered raw containment cannot be promoted into proof of `525 -> 30`.

### Recovered post-generation selector commit

Commit `450f8fae800d3f509ef868ab035f0cd731216279` (`research: freeze exact recovered Quality102 selector logic`) performs downstream S34 transforms from materialized rows. For BRK it reads `strength` from the input row and gates on:

```text
strength >= 0.03
side * ret14 >= -0.05
```

It calculates `ret14` separately from market data. It does not define the upstream OHLCV calculation that produced BRK `strength`.

Therefore this commit cannot be used as proof of the missing BRK strength formula.

## External research-batch lineage observations

ChatGPT Library metadata retained a model-generated research batch around `2026-08-29T11:46Z`:

```text
variant_results_fast.csv
dev_key_metrics.csv
balanced_oos_trades.csv
expansion_oos_trades.csv
strict_oos_trades.csv
tier_results.csv
```

A later model-generated copy of `quality_one_slot_candidate.csv` is also retained. These files are useful forensic evidence, but their generating Python cell/script is not repository-anchored and has not been recovered. For that reason the files are **not** accepted as causal provenance by the LIVE gate.

The retained OOS rows also show the same symbol/entry timestamp carrying identical BRK `strength` across different BRK variants. This narrows the likely feature lineage but is not an authoritative formula and must not be implemented by inference alone.

## Archived HIGH_VOL scanner is related evidence, not the missing selector

A retained `PENGU_HIGH_VOL_SCANNER_SELECTED_TRADES.csv` archive contains a documented satellite ranking path with `priority_score`, `selection_month`, and trailing metrics. Comparing exact `(symbol, entry)` identities against the final Quality102 HIGH_VOL rows produced only four exact overlaps:

```text
SUI  2025-09-08
OP   2025-09-21
SEI  2025-10-10
ARB  2026-03-04
```

This makes it a related research lineage, not proof of the exact Quality102 `525 -> 30` selector. No ranking rule from that archive is promoted into production Quality102 code.

## Current machine-readable safety conclusion

```text
HIGH_VOL_RAW_GENERATOR_IMPLEMENTED=true
HIGH_VOL_OLD_UNIVERSE_RECOVERED_PARITY=137/137
HIGH_VOL_EXPANDED_UNIVERSE_RECOVERED_PARITY=388/388
HIGH_VOL_COMBINED_RAW_EXPECTED=525
HIGH_VOL_525_TO_30_SELECTOR_PROVEN=false

PB_MR_REV_POST_GENERATION_RECOVERED=true
BRK_STRENGTH_FORMULA_PROVEN=false

QUALITY102_CAUSAL_PIPELINE_IMPLEMENTED=true
QUALITY102_SELECTOR_IMPLEMENTED=false
QUALITY102_LIVE_ARMED=false
QUALITY102_LIVE=FAIL_CLOSED
LIVE_ACTIVATED=false
ORDERS_SENT=0
TEST_ORDERS=0
ARTIFICIAL_LIVE_ORDERS=0
```

No inferred formula, output-membership lookup, frozen timestamp list, operator flag, or fixed CSV may substitute for the two missing proofs.

## Remaining provenance source not yet inspectable

The authorized desktop `DESKTOP-JUK6Q1I` was offline during this inspection. Its local clone may still contain reflog entries, dangling Git objects, unpushed commits, shell history, notebook checkpoints, or temporary Python files that are absent from GitHub and the retained Actions artifact.

If that source becomes available, it is the highest-value remaining place to search. Until then the correct production state is fail-closed.
