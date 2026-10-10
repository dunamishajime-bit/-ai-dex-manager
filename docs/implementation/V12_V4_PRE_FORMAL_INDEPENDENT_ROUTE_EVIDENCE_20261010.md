# V12 V4 — formal period outside-window route observations (2026-10-10)

**STATUS: PASS_PRE_FORMAL_178_OF_178_H1_EXIT_PRICE_MODEL**.
**Not a pristine independent-forward strategy certificate. Not authorized for LIVE orders.**

The adopted V12 V4 model has 41 frozen routes. Existing independent
August–October 2026 replay observed 25 routes (258/258 signed-source
candidate/exit matches); the other 16 were not observed in that period.
A separate original formal 2025-08-10 to 2026-08-10 accepted-trade
replay matched all 16 missing routes (212/212 historical Entry/Rank/Gross,
212/212 independent H1 price-model exits).

## New read-only Aster preformal period

- 2025-01-13 00:00 UTC through 2025-08-10 00:00 UTC, **no overlap** with
  the adopted formal-year testing period.
- Exact original Aster normalized H1 of the 14 frozen V12 symbols;
  alignment to common closed H2 bars before feature calculation.
- 2,508 common H2 decision clocks; 1,027 native base source signals.
- **11 of the external-absent 16 routes produced 178 route candidates**,
  all unique by route/symbol/side/entry timestamp. There were no scanner
  exception gaps. 140 TIME and 38 ATR candidates.
- Independent pure-Python STOP-first H1 fill model reproduced
  **178/178** Production calculated Entry opens and Exit
  timestamp/price/reason; no mismatches.

Five still had **zero** candidate opportunities in this additional period:
`REC_Y04_REV_D2_T36`, `REC_Y05_REV_D2_T9`,
`REC_Y10_REV_D2_T24`, `REC_Y13_REV_D2_T36`,
`REC_Y17_REV_D1_T3`.
They are verified retrospectively in the formal year but NOT certified
out of fit or in any later forward period. Their lack of observations
must not be counted as five passing external samples.

Reproduction:
```bash
npx tsx scripts/v12-v4-preformal-sixteen-route-observer.ts
python scripts/research/v12_v4_preformal_independent_exit_check.py
npx tsx --test tests/v12-v4-preformal-2025-independent-evidence.test.ts
```

Committed evidence (market and source SHA-256 provenance included):
- `docs/ops/v12-v4-cert-20261009/preformal-2025-native-route-coverage.json`
- `docs/ops/v12-v4-cert-20261009/preformal-2025-independent-exit-check.json`

**Limitations:** This data predates the formal adopted testing period,
but the route definitions were studied/tuned retrospectively and may
reflect earlier data. It cannot be called pristine previously-unseen
forward performance. It proves only candidate occurrence and equality
of two price models in this period. No signed Aster fill, queue,
orderbook, server STOP guarantee, partial-fill race or real-money PnL
is attested. Remaining operator/venue execution authorization gates
are unchanged.
