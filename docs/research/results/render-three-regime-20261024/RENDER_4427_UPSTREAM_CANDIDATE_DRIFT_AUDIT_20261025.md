# RENDER #4427 — upstream candidate drift audit (2026-10-25)

STATUS: RESEARCH ONLY; root cause and formal Owner/Route safety parity remain unproven.

## New, independently checkable finding
The first replay differs BEFORE the portfolio admission/decision logger. The pre-allocation candidate manifest contains 20 additional V12 rows; their strategy/symbol/side/route/timestamp keys match exactly the 20 first-run-only `V12:TASK9_ADVERSE_SIDE_COOLDOWN` rejections.

| Cost | First source rows | Later source rows | First decision rows | Later decision rows | Other source rows equal |
|---|---:|---:|---:|---:|---|
| 10bps | 2444 | 2424 / 2424 | 2543 | 2523 / 2523 | YES, exact order/content |
| 30bps | 2444 | 2424 / 2424 | 2543 | 2523 / 2523 | YES, exact order/content |

The two later candidate manifests are byte-identical; so are their decision files. Removing precisely the 20 extra first-run source rows leaves an exact match with both later manifests. The extra key set is the same at 10bps and 30bps.

## Causal scope and next diagnostic
This narrows the problem to pre-allocation candidate generation / research source transformation, not just decision IDs or decision logging. It does NOT yet prove whether the cause is mutable Python module state, cached input, repeated study-adapter installation, or an earlier source artifact. To prove that, instrument candidate counts and source SHA immediately before and after each stage in a fresh isolated process.

## Fail-closed limits
- The exact state/cache or generator mutation that changes the pre-allocation candidate manifest has not been proven.
- These are archived modeled replays, not fresh clean-process cold/warm executions.
- No formal independent Owner/Route registration or full safety gate parity is proven.
- Aster 2025 RENDER H1 mark missing; actual Aster M5 fills and funding not authenticated.
- All historical periods were already explored and are not untouched OOS.
- No VPS/LIVE/Production/HP/real order changes.

Evidence: archived Native8 candidate and decision JSONL paths and SHA256 in the accompanying JSON. Audit script is deterministic and read-only except for its report output under C:/tmp/render-mtf-study-20261024.
