# Aster-only V52 Dual-Slot Basis Engine Result

## Decision

The spare-capital idea worked historically. Allowing frozen V11-EQ and frozen V50 to occupy separate slots increased the exact trailing-365-day return while respecting the configured Stock Gross cap.

Status:

`ASTER_ONLY_V52_DUAL_SLOT_DID_NOT_PASS_RAISED_HURDLES`

The only failed raised check was the frozen narrow Validation minimum: five accepted Normal trades versus the required eight. Annual return, P95, PF, DD, concentration, Final, July Holdout, removal checks and Gross-cap checks passed.

## Frozen design

- V11-EQ: `BOTH__FLAT__CONVERGENCE__ABS_TOP1`, 10:30 New York, maximum Gross 1.0;
- V50: `POST_EARLY3__B75__H3__BOTH__NONE`, 11:30 / 12:30 / 13:30 New York, maximum Gross 1.0;
- first filled position is preserved;
- later signal receives remaining Gross only;
- one V11 slot and one V50 slot;
- same-symbol concurrent entry prohibited;
- no forced replacement;
- minimum partial allocation Gross 0.25;
- AsterDEX only;
- Crypto V96 excluded from this Stock-only test.

The allocator is symmetric, but under the frozen clock schedule V11 always has the earlier possible entry. Therefore the historical reverse-order count was zero; the code nevertheless applies the same remaining-Gross rule regardless of strategy identity.

## Exact trailing-365-day comparison

Period: 2025-07-25 inclusive through 2026-07-25 exclusive.

| Architecture | Normal | P95 | Normal PF | Normal DD | Normal trades | Max observed Gross | Net bps/capital-hour |
|---|---:|---:|---:|---:|---:|---:|---:|
| V11 only | +59.791949% | +56.497767% | 5.666997 | -4.313048% | 61 | 1.0 | 22.864333 |
| V50 only | +73.915217% | +66.730178% | 3.337497 | -4.136789% | 106 | 1.0 | 23.393383 |
| Unified sequential, Gross 1.0 | +122.352197% | +112.036155% | 4.395829 | -4.313048% | 128 | 1.0 | 23.416785 |
| Dual slot, Gross 1.5 | +131.582718% | +120.488043% | 4.479085 | -4.120905% | 141 | 1.5 | 23.707613 |
| Dual slot, Gross 2.0 | **+136.268475%** | **+124.143339%** | 4.223214 | -4.313048% | 141 | 2.0 | 22.773650 |

## Marginal effect of spare-capital operation

Relative to the same unified engine restricted to Gross 1.0:

- Gross 1.5 added +9.230521 percentage points Normal and +8.451888 points P95;
- Gross 2.0 added +13.916278 percentage points Normal and +12.107184 points P95.

Gross 2.0 produced the highest raw return. Gross 1.5 had the better PF, shallower DD and higher capital-hour efficiency.

## Dual-slot Gross 2.0 routing

Normal scenario:

- 61 V11 entries;
- 80 V50 entries;
- 18 V50 entries occurred while a V11 position was active;
- 61 same-symbol concurrent signals were blocked;
- 53 V50 signals were blocked because the V50 slot was already occupied;
- observed maximum Gross was exactly 2.0;
- no Gross-cap breach occurred.

The frozen schedule generated no historical case where V50 was active before a later V11 signal. This is a clock-order fact, not an asymmetric allocator rule.

## Chronological evidence for Gross 2.0

| Segment | Normal | P95 | Normal trades | Normal PF | Normal DD |
|---|---:|---:|---:|---:|---:|
| Development | +87.358422% | +80.271024% | 97 | 4.176381 | -4.313048% |
| Validation | +5.303083% | +5.094801% | **5** | 14.021623 | -0.400000% |
| Final reused | +12.272729% | +11.270592% | 31 | 2.898301 | -3.603124% |
| July Holdout | +6.663835% | +6.325708% | 8 | 17.274154 | -0.400000% |

All chronological blocks were Normal/P95 positive. The original narrow Validation count requirement remained failed and was not relaxed.

## Raised checks

Passed:

- Normal >= +100%;
- P95 >= +85%;
- PF >= 1.5;
- DD no worse than -15%;
- Validation Normal/P95 positive;
- Final Normal/P95 positive;
- July Holdout minimum three trades and Normal/P95 positive;
- positive-profit symbol concentration <= 40%;
- best-trade and best-month removal positive;
- Severe fail-closed/nonnegative;
- Normal and P95 Gross caps respected.

Failed:

- Validation minimum eight trades: five.

## Interpretation

The spare-capital concept is supported by the historical proxy. The strongest raw-return configuration is Stock Gross 2.0, but Gross 1.5 is the better risk-adjusted configuration and leaves more room for Crypto V96 and maintenance-margin reserves.

This Stock-only result cannot authorize a live Stock Gross 2.0 setting because Crypto V96 capital reservation, real-time maintenance margin, spread/depth, queue fills and mark-to-market daily loss control were not included. The next required test is a combined V96 + V11 + V50 capital-priority replay or no-order Forward Shadow.

## Evidence

- PR: #94
- Workflow run: `30196905187`
- Artifact: `8630388386`
- Artifact SHA-256: `82d452b33e6ca4942aee566950fd5402da0c32f0a66556d6383abfbda9c501e8`
- CI backtest: success
- CI safety validation: success

## Safety

Research only. Production, LIVE, VPS, credentials, orders, positions, Crypto V96, V11 and V50 runtime were not changed.
