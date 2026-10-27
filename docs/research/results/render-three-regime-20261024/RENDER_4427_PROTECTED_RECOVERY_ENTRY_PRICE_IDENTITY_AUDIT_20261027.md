# RENDER #4427 — protected recovery venue entryPrice / position identity audit (2026-10-27 JST)

**RESEARCH_ONLY / NEW_FINDING_VENUE_ENTRY_PRICE_NOT_BOUND / NEED_NATIVE_ALLOCATOR / order_authorized=false**

## Newly demonstrated boundary

The fixed original TypeScript `recoverIdleProtectedRateBudgetState()` checks the saved RENDER SHORT position against a venue row using **symbol, side, and quantity**, but does not compare the venue's average **entryPrice** against the saved position's `entryPrice`. The primary `AsterPositionRiskRow` type exposes `entryPrice: string`; the CLI `getPositions()` adapter drops it before `assertVenuePosition()` runs.

Executing the unmodified original TypeScript on the owner's Windows filesystem with synthetic venue readback and a saved SHORT position at entryPrice=100, changing the venue position's entryPrice to **50, 75, 99, 101, 125, 200, or 1000** still produced `IDLE_PROTECTED_RATE_BUDGET_RECOVERY_PASS` and cleared `manualReview`. Values 0, -10, nonnumeric, NaN string, or absent were likewise accepted. All controls with wrong STOP price, missing STOP, non-null pending, or LONG side were rejected.

This establishes a **position economic-identity/readback gap** distinct from the already reported marginType/leverage, position quantity tolerance, venue timestamp, order identity, and post-readback race boundaries. A venue row matching symbol/side/quantity alone cannot certify that the stored entry basis and current venue exposure are the same economic position.

**Limitation:** Aster average entryPrice can legitimately change after fills or position adjustments. A mismatch by itself is not proof of a foreign position; a safe remedy requires authenticated fill/position lineage and appropriate basis reconciliation, not unconditional strict equality. Synthetic readback is not evidence of a real Aster incident, Native8, 13 GateProof, or Production.

## Primary source and reproducibility

Fixed primary GitHub commit: `939b59da49ce7960485a2004b0068dc63417ae82`. Actual raw GitHub bytes were fetched again on the owner PC and SHA256 pinned before testing:

- `config/idlePriorityShortPolicy.ts`: `6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8`
- `lib/aster-v3-client.ts`: `4c245ed0e9bbcdeac4796f19596928d36647fb6f1b0008fdb102a2d2f16b0baf`
- `lib/idle-priority-short-state.ts`: `4f09cb0c7f430ffde65c993b7ac57af8284605eefa89df2d11973bb77ec09f07`
- `scripts/disdex-idle-priority-short-protected-rate-budget-recovery.ts`: `70f319371e39e22d0df3b355b079c8336e5d205f022fe6ee752e218f60a4fc09`

Original TS executed using Node `stripTypeScriptTypes` and VM; saved state, backup, rename and readback used the real Windows filesystem. Only the venue response was synthetic. The independent Python launcher A (runpy) and launcher B (subprocess) were each executed with normal, `-O`, and `-OO` optimization.

- **102/102 expected case outcomes matched**, six child processes exit 0.
- Per-process case count: **17**.
- Canonical SHA256 identical across all six: `a5799e99dc8d86e4e2deaac644011d82cef2815904c148e50fbefb126b224d72`.
- Audit script SHA256: `c65976f04c474197f89c900901ed892c0a81a2a9937259bb70007871ff9ff86b`.

## Boundaries

Owner=`IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH`; Route=`IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT`; Gross=0.25x. No new order authorization: **NEED_NATIVE_ALLOCATOR / order_authorized=false**. No changes to VPS, LIVE, Production, HP, real orders, current eight strategies, old IDLE Core `_overlay_block`, or existing dirty worktrees. Research output confined to `C:/Users/dis/render4427-research-only/`; `C:/tmp` not accessed.

Next investigate the actual operator caller and Aster adapter's authenticated entry-basis/fill identity, position snapshot sequence, owner/route/lease/Account Lock, Native8 preallocation, and 13 GateProof. Do not treat synthetic receipts as real or previously explored samples as OOS.
