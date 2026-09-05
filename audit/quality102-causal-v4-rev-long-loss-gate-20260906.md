# Quality102 Causal V4 REV Long Loss Gate

Date: 2026-09-06
Mode: RESEARCH / FAIL-CLOSED

## Change

The V4 improvement gate rejects only S34 `REV` long candidates whose entry-time `ret14` is below `+24%`:

`family == REV && side == LONG && ret14 < 0.24 -> reject`

All other families, REV shorts, and REV longs at or above `0.24` pass this additive gate. The recovered historical S34 Quality Gate is unchanged.

Tracked entry points:
- `evaluateQuality102CausalV4ImprovementGate()`
- `buildQuality102CausalV4Selection()`
- Python parity helper `passes_v4_improvement_gate()`

## Validation evidence

The threshold was selected on the pre-2026-01-15 train region and then frozen before holdout evaluation. On V4 standalone selection, holdout return improved from `+55.73%` to `+62.89%`, PF from `2.94` to `3.62`, win rate from `62.0%` to `70.45%`, and DD from `-5.53%` to `-3.66%`; all 6 removed holdout trades were losses.

Exact MTM integrated BT for `V4 + gate`:
- NORMAL ending asset: `¥3,204,452.91664423`
- NORMAL PF: `3.58872414`
- NORMAL DD: `-9.79910652%`
- SEVERE ending asset: `¥919,049.65821696`
- SEVERE PF: `2.56513419`
- SEVERE DD: `-16.16574496%`
- Crypto Gross: `2.0x`, Total Gross: `2.5x`, Quality Gross: `0.5x`
- Gross conflicts: `0`

For comparison, the same gate on V3 produced NORMAL `¥3,201,388.77961084`, PF `3.45496364` and SEVERE `¥922,012.44254417`, PF `2.48333587`.

## Safety

No LIVE capability flag is changed. `QUALITY102_CAUSAL_CAPABILITIES.selectorImplemented` remains `false`, raw generator proof flags remain `false`, and the existing Fail-Closed behavior remains authoritative until the upstream causal selector is fully proven.
## Frozen V4 feature configuration

The full tracked V4 wrapper also applies the train-selected feature gates before the REV-long loss gate:
- MR: `side*ret14 in [-0.15,-0.08)`, `developmentN>=20`, `developmentSpf>=0`, `developmentAvg>=0`, `margin in [1.05,1.70)`.
- PB: `side*ret14 in [-0.50,0.20)`, `developmentSpf>=0`, `developmentAvg>=0`, `margin in [1.00,1.70)`.
- REV: `side*ret14 in [0.10,0.30)`, `developmentSpf>=0`, `developmentAvg>=0`, `margin in [1.00,3.00)`, then REV Long additionally requires `ret14>=0.24`.
- BRK: only `FET|BRK24_H48_V1.2` with aligned ret14 `[0.15,0.30)`, `NEAR|BRK48_H48_V1.2` with `[-0.05,0.02)`, and `RENDER|BRK168_H12_V1.2` with `[0.15,0.30)`.

`buildQuality102CausalV4Selection()` enables both the frozen V4 feature gate and the REV-long improvement gate. The legacy `buildQuality102Selection()` remains unchanged for historical parity.
The REV-long improvement gate is applied **after** V4 one-slot routing, matching the validated research run. A rejected REV long does not cause a previously slot-blocked candidate to backfill the slot. A tracked parity reconstruction reproduced the validated V4+Gate set exactly: `90/90` identities, with `0` tracked-only and `0` expected-only rows.