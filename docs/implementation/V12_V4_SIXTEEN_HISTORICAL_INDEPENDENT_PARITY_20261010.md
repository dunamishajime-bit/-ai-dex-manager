# V12 V4 — previously absent 16 routes: independent historical replay

**Date:** 2026-10-10
**Decision:** PASS on *retrospective accepted-trade source, Entry, rank, sizing, and independent H1 price-model Exit* for all 16 routes. This is not proof that those routes fired in the separate Aug–Oct external period, nor a certificate for real venue orders.

## Exact evidence

- Original policy: `V2_M150_D05_CORE_NATIVE`, 41 routes.
- Existing external causal replay: 25/41 routes (258/258 Entry and 258/258 Exit; these 16 routes had no observed external matches).
- The **other 16 routes** have **212 accepted V12 trades** in the original Aug 2025–Aug 2026 one-year research BT.
- Regenerated the original **188 distinct H2 closed source clocks** using the unmodified native `computeNativeV4Sources()`. All 212 accepted source identities were found; zero missing H2 windows.
- Recomputed each of the 212 candidates with Production `adaptProductionCandidates()` from original unmodified Aster completed H1. Route, symbol, side, entry timestamp, rank and requested Gross match **212/212**.
- Independently calculated Entry open, H1 STOP-first ATR TP/SL and TIME exits in a separate Python read-only implementation. Entry price, Exit timestamp, modeled Exit price and reason match **212/212**.
- Counts: 15 TIME routes = 190 trades, 1 ATR route `REC_X13_TP1.5_SL1_H24` = 22 trades. All 16 route names have 100% of their accepted sampled trades matched.
- Two cases initially differed: `REC_G4_MATURE_REL_RANGE` ATOMUSDT at 2026-03-28 20:00 UTC, and `REC_X04_TIME_24H` ATOMUSDT at 2026-05-01 12:00 UTC. Their prior 24h quote-volume medians were exactly zero. The original Python emits `None` for missing volume ratio; Production incorrectly threw `FEATURE_VOLUME_MEDIAN_ZERO`. Corrected Production feature to return `undefined`, so routes requiring VOL_GE1 or VOL_LT1 remain false while other route gates work. **No filter was relaxed by treating unavailable volume as zero.**

## Evidence and commands

Production source replay:

`npm exec -- tsx scripts/v12-v4-historical-sixteen-source-entry-parity.ts`

Independent price-model Exit:

`python scripts/research/v12_v4_historical_sixteen_exit_parity.py`

Regression:

`npm exec -- tsx --test tests/v12-v4-zero-volume-causal.test.ts`

Evidence reports (SHA-256 input hashes included):

- `docs/ops/v12-v4-cert-20261009/historical-sixteen-independent-replay.json`
- `docs/ops/v12-v4-cert-20261009/historical-sixteen-independent-exit.json`

Source historical original accepted ledger and candidate ledger from `docs/research/results/v4-production-cert-20261009/bt-baseline/`. Exact Aster normalized H1 bars from authorized research Windows PC. Read-only tools do not open exchange sessions or issue orders.

## Exact scope restrictions

1. Independent historical **accepted-trade membership** is confirmed; exhaustive no-extra/no-missing candidate parity across *every historical H2 clock*, including unrealized candidates and every Gross collision, is a different certification.
2. The 16 absent routes did **not** produce independent external-period samples; do not mislabel the in-sample replay as 41/41 **out-of-period** certification. External validation still covers only 25 routes.
3. Price-model historical Exit is not an Aster real signed-fill, mark-price resident-stop, tick/quantity, or orderbook execution certificate.
4. The previously documented external-period weak performance (especially Y06 reversal) remains a substantive adoption risk; no improvement was manufactured by this replay.
5. Operator `assertSourceParity`, root-owned STOP policy approval, execution certification, protective same-symbol broker races, multi-runner Gross and risk gates are separate conditions. **No LIVE activation is authorized.**

**Final evidence status:** `PASS_16_OF_16_HISTORICAL_ROUTE_ACCEPTED_SOURCE_AND_PRICE_MODEL_EXIT`. Full operational cutover status is unchanged.
