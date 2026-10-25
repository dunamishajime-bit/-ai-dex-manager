# RENDER #4427 — 0.25x quantity-gate contract audit (2026-10-26)

## New audited finding

At pinned source commit `939b59da49ce7960485a2004b0068dc63417ae82`, the existing IDLE RENDER and DOT routes request **0.25x** Gross, but the shared `evaluateIdleOneStepFloor()` quantity validator enforces **1.00x**. Consequently a correctly normalized 0.25x lot is rejected with `QUANTITY_NOT_ONE_STEP_FLOOR` before any reservation or order submission. This is a fixed-source code-path finding, **not** proof of a failed actual exchange order or parity with current Production.

The distinct issue is independent of the previously audited all-or-nothing multi-signal capacity check. Even if a 0.25x RENDER candidate passes the aggregate capacity and the route admission check, this downstream validator rejects its correctly sized lot.

## Exact primary-code path

1. `config/idlePriorityShortPolicy.ts` sets `RENDERUSDT.gross=0.25` and `DOTUSDT.gross=0.25`.
2. `lib/idle-priority-short-live.ts` sets `requestedGross` from the route and can return `admission.gross=requestedGross` when the independent safety gates pass.
3. `lib/idle-priority-short-runner.ts` calls `normalizeMarketQuantity(symbol, equity * requestedGross / quote.bidPrice, quote.bidPrice)`.
4. The same Runner calls `evaluateIdleOneStepFloor()` **before** `lock.reserve` and `executor.executeMarket`; if rejected, it returns `IDLE_QUANTITY_REJECTED`.
5. `lib/idle-quantity-feasibility.ts` calculates `desired=equityUsd/referencePrice` and `requiredGross:1`, not the route-specific Gross. It requires the normalized quantity to be one step below that **1x** desired quantity and the actual Gross to be at least 0.99x.

## Independent reproduction

All four source files were downloaded as raw bytes from the fixed commit on the authorized owner PC and matched SHA256 pins. The pure original TypeScript feasibility module was stripped of type annotations using Node's `stripTypeScriptTypes` and executed **in memory**, with no Native8 import, no source mutation, no venue calls and no filesystem writes. The Runner and policy call chain was checked statically against pinned primary bytes.

Two separate owner-PC Python processes were run under each of `normal`, `-O`, `-OO` (six processes). Each process exercised six deterministic synthetic quantity cases using the exact original TypeScript validator: **36/36 expected verdicts, identical canonical audit JSON**.

| Synthetic quantity case | Requested Gross | Original TypeScript verdict |
| --- | ---: | --- |
| RENDER valid 0.25x lot | 0.25x | REJECT: QUANTITY_NOT_ONE_STEP_FLOOR |
| DOT valid 0.25x lot | 0.25x | REJECT: QUANTITY_NOT_ONE_STEP_FLOOR |
| RENDER 0.25x, alternative price | 0.25x | REJECT: QUANTITY_NOT_ONE_STEP_FLOOR |
| RENDER hypothetical reduced 0.125x | 0.125x | REJECT: QUANTITY_NOT_ONE_STEP_FLOOR |
| 1.00x exact control | 1.00x | ACCEPT: FULL_1X_EXACT |
| 1.00x one-step floor control | ~1.00x | ACCEPT: VENUE_STEP_ROUNDING_OK |

Pinned source SHA256: quantity validator `4d87b6456f75077aabb1db2422c960d95386ae6ffbb924b878d40a8eeeef664d`; runner `0a5682f30add54b7f03714c8b40596af80f6b80cd04b360c6009f62f3cb22f33`; live admission `185e0991cb810bba903dfa299df70f5a1e805fe6d9b76242247e672bcd30889c`; policy `6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8`.

Owner-PC-fetched audit script SHA256: `396c06eea05d3a4de52098d98901dcb947caf27cd69c812dea551a677908ea0d`.

Canonical audit result SHA256 (all six processes): `78b84911d01381fe2eb95ce36ae1024454cbb140e1a75bfe5b5e9f70f79c4e40`.

## Required design investigation (not implemented)

A **research-only** future change should make the lot validator accept an explicit, proof-bound `expectedGross`, derive `desiredQuantity=equity*expectedGross/referencePrice`, apply step-floor tolerance **relative to that Gross**, and preserve min/max quantity, notional, actualGross, account lock, pending reservation, Shared Risk, Margin Guard, Kill Switch, same-symbol dedup, and cooldown. The accepted quantity, `admission.gross`, `reservation.gross`, `pending.gross`, and `maxEntryNotionalUsd` must all bind to the same immutable, re-attested allocation. Gross reductions require fresh proof, not reuse of an old GateProof.

Do not patch the LIVE Runner, do not force an order, do not increase the route to 1x to work around this rejection, and do not use route-specific order IDs to bypass same-symbol dedup. No actual venue M5 fills, funding, Native8 preallocation, Owner/Route registration, 13 GateProof, independent operator trust root, current Production SHA parity, or economic BT is certified by this audit. Status remains **RESEARCH_ONLY / NEED_NATIVE_ALLOCATOR / NO_ORDER_AUTHORIZATION**.

## Reproduction and files

- `scripts/dd-reduction/audit_render4427_quarter_gross_lot_gate_20261026.py`
- `docs/research/results/render-three-regime-20261024/RENDER_4427_QUARTER_GROSS_LOT_GATE_AUDIT_20261026.json`

No VPS, LIVE, Production, HP, real orders, existing eight strategies, old IDLE Core `_overlay_block`, or dirty worktree were changed. The owner PC was used read-only and `C:/tmp` was not accessed.
