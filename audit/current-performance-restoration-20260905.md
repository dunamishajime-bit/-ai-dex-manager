# Current performance restoration audit - 2026-09-05

## Scope

Base: `8947561ea8c3c1a50e7f9863570c2c25f9f378ee`.
Research branch: `research/current-performance-restoration-20260905`.
Goal: identify causally defensible changes that explain/recover the historical ~JPY 4.10M one-year DCA result without fitting to the ending asset.
No LIVE/VPS/order mutation is part of this branch.

## Reproduced gap

| Item | Historical strict BT | Current causal BT |
| --- | ---: | ---: |
| Normal ending asset | JPY 4,104,976.84 | JPY 882,837.57 |
| Normal PF | 3.5825 | 2.7789 |
| Normal closed-event DD | -12.1772% | -11.6187% |
| Q102-off ending asset | JPY 1,180,343.66 | JPY 592,884.28 |

The full gap is 4.6498x. The Q102-off gap is 1.9908x. Historical Q102 uplift is 3.4778x versus 1.4891x now, a 2.3356x uplift-ratio gap. `1.9908 * 2.3356 ~= 4.6498`, so PENGU and Q102 explain essentially the complete ending-asset difference.

## Fix point 1 - PENGU Recovery V8

Historical BT used `PENGU_DUAL_LS_V2_RECOVERY_V8`, while current production used plain PENGU V2/Short V20. The frozen Recovery V8 implementation from commit `5a98a7e0` was rebased onto the current base while retaining the current strict portfolio/Q102 conflict logic.

Historical parity remains exact: 70 trades, +574.2299% Normal return, PF 4.3312, DD -12.8489%. Current plain PENGU external parity also remains intact.

A missing safety boundary was fixed: Recovery entry is now explicit opt-in. `selectPenguRecoveryV8Entry(..., false)` cannot emit a Recovery signal, and the LIVE runner consumes a compile-time promotion object whose `liveEnabled` is false.

Fresh post-freeze check used Binance USD-M 1H only because the Aster public Kline endpoint returned HTTP 403 from this validation host. From 2026-08-28 through observed 2026-09-04 data there were 190 completed post-freeze rows, one Recovery signal, zero wins, and that signal hit the 6% underlying hard stop for -3.0% account return at 0.50x gross. This is insufficient evidence for LIVE promotion, so Recovery V8 remains fail-closed/default OFF.

## Fix point 2 - Quality102

Historical ~JPY 4.10M used the frozen 102-event source. Current LIVE-capable Q102 is `DERIVED_HIGH_VOL_ONLY` and the fresh one-year standalone run produced 58 trades.

Recovered evidence is narrower than the historical 102 set: HIGH_VOL raw generation reproduces 137/137 old-universe and 388/388 expanded-universe candidates (525/525 total), but the exact 525 -> 30 selector is still unproven. PB/MR/REV post-generation gates are recovered, but their complete S3/S4 upstream raw generator is not proven. BRK additionally lacks a proven OHLCV `strength` formula.

Therefore this branch does not synthesize S3/S4 or enable BRK/PB/MR/REV to chase the old result. The concrete Q102 correction sequence is: prove 525 -> 30 membership; recover/prove S3/S4 raw generation; prove BRK strength from OHLCV; then connect those producers to `buildQuality102CausalV1Signal`; rerun fresh integrated BT with the same 2.0x crypto / 2.5x total gross rules.

## Promotion decision

- PENGU Recovery V8 implementation: restored and testable, **LIVE OFF** pending adequate post-freeze holdout.
- Q102 S3/S4 expansion: **not implemented**, because upstream provenance is incomplete.
- Existing V12/PENGU/V52/Q102 LIVE behavior: unchanged by this research branch.
- Historical JPY 4.10M remains a forensic benchmark, not an acceptance target.
