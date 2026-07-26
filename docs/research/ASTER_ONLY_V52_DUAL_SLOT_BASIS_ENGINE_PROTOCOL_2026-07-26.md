# Aster-only V52 Dual-Slot Basis Engine Protocol

## Objective

Measure whether the frozen V11-EQ and frozen V50 post-open Basis engine earn more when they share one Aster account and may overlap whenever unused Stock Gross remains.

## Frozen components

- V11-EQ: `BOTH__FLAT__CONVERGENCE__ABS_TOP1`, maximum Gross 1.0, 10:30 New York entry;
- V50: `POST_EARLY3__B75__H3__BOTH__NONE`, maximum Gross 1.0, 11:30 / 12:30 / 13:30 New York entries;
- both use the synchronized U.S. cash-versus-Aster Basis-convergence thesis;
- no threshold or exit retuning.

## Symmetric allocator

- first filled position is preserved until its own exit;
- a later signal receives only remaining Gross;
- allocator supports either strategy arriving first;
- under the frozen clock schedule V11 normally arrives before V50, so the reverse sequence may have zero historical occurrences;
- no forced replacement or partial liquidation of an existing position;
- one active V11 slot and one active V50 slot;
- concurrent positions in the same symbol are prohibited;
- minimum partial allocation is Gross 0.25;
- daily realized-loss lock is -2%.

## Compared architectures

1. V11 only, Gross cap 1.0;
2. V50 only, Gross cap 1.0;
3. unified sequential engine, total Gross cap 1.0;
4. dual-slot dynamic spare-capital engine, total Gross cap 1.5;
5. dual-slot dynamic spare-capital engine, total Gross cap 2.0.

## Exact period and scenarios

- exact trailing 365 days: 2025-07-25 inclusive through 2026-07-25 exclusive;
- Forward Median round trip 24 bps;
- Normal round trip 40 bps;
- P95 round trip 44 bps;
- Severe 100 bps fail-closed;
- actual historical Aster Funding included.

## Raised dual-slot hurdle

The Gross 2.0 version must achieve:

- Normal >= +100%;
- P95 >= +85%;
- PF >= 1.5;
- maximum DD no worse than -15%;
- Validation at least 8 accepted trades and Normal/P95 positive;
- Final and July Holdout Normal/P95 positive;
- positive-profit symbol concentration <= 40%;
- best-trade and best-month removal remain positive;
- Severe fail-closed/nonnegative;
- observed Gross never exceeds the configured cap.

## Scope limitation

This is a Stock-only comparison. Crypto V96 positions and reserved margin are not included. A result at Stock Gross 2.0 cannot be transferred directly to the live combined account until a separate V96-capital-priority simulation is completed.

## Safety

Research only. Production, LIVE, VPS, credentials, orders, positions, V96, V11 and V50 runtime are unchanged.
