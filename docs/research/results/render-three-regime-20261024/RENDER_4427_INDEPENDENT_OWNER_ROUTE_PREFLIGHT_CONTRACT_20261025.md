# RENDER #4427 — independent SHORT research Owner/Route preflight contract (2026-10-25)

**STATUS: RESEARCH_ONLY_CONTRACT_UNIT_TESTED / NATIVE8_NOT_INTEGRATED / FAIL_CLOSED**

## Scope and lineage

- Based on `research/render4427-fresh-process-raw-determinism-20261025`, commit `4ccd470262e57eb9dee273ba3faeb9b013a526c2`.
- New code is an isolated, pure research module. No existing runner, production, allocator, owner registry, VPS, HP, order code, or baseline result is modified.
- Existing source has a research in-memory `_overlay_block` change for independent RENDER. This module **does not** clear `_overlay_block` or silently promote a rejected candidate. It cannot authorize an order.

## Research-only Owner/Route binding

| Field | Value |
|---|---|
| Strategy and capital owner | `IDLE` |
| Distinct research owner | `IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH` |
| Route | `IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT` |
| Symbol/side | `RENDERUSDT` / `SHORT` |
| Maximum requested gross for this research route | `0.25` (does not raise native caps) |
| Successful preflight | `NEED_NATIVE_ALLOCATOR`, **never** `ORDER_AUTHORIZED` |

Every candidate requires as-of, candidate-key-bound proof of explicit native route registration, source features, Shared Risk, Gross, Margin Guard, Kill Switch, account lock, dedup, pending orders, cooldown, same-symbol exclusivity, slot availability and native owner-priority resolution. Position/pending inventories and cooldown timestamp must also be present. Unknown, false, future-dated, malformed, or wrong-candidate evidence fails closed.

Proof SHA shape checking and synthetic test fixtures **are not authentication**. An adapter must bind these fields to immutable primary Native8 input and signed/verified evidence before the contract can be used for a real admission study.

## Executed unit tests (synthetic only)

`python -m unittest -v test_render_4427_independent_owner_route_contract_20261025.py`

- 13 tests passed in an isolated Python environment.
- Synthetic same-symbol RENDER position is rejected even with all other gate proofs marked PASS. This encodes the May 27 collision invariant, not a fresh venue replay.
- Unknown native Margin/Account Lock evidence rejects a candidate; no inference that the June 23/25 candidates are safe.
- Each mandatory gate independently rejects when failed; future-dated or candidate-mismatched proof rejects; pending and cooldown reject; wrong Owner/Route and over-0.25 gross reject.
- Even a fully synthetic PASS returns `NEED_NATIVE_ALLOCATOR` and `native_order_authorized=False`.

## Required next evidence / strict limits

1. Bind a **real, separately registered research-only Owner/Route** into the native preallocation/priority pipeline, not via the old IDLE Core `_overlay_block` mutation. Maintain the IDLE shared capital bucket and incumbent owner priority.
2. Obtain primary native as-of proof for the 2026-05-27, 06-23, 06-25 candidates: positions, 12h cooldown, shared risk, gross, margin, kill switch, pending, account lock, dedup and final allocator rejection/acceptance reasons. Reject May 27 on same-symbol conflict.
3. Only then run 10/30bps Native8 in independent fresh Python processes, compare converged raw candidate/decision/trade/event/MTM SHA including IDs and 8-strategy final assets, MTM DD, PF, WR, trades and collisions.
4. 2025 Aster RENDER H1 mark remains missing; real Aster M5 fills and Funding remain unverified. All historical windows have been explored and are **not** untouched OOS. New LIVE Forward Shadow evidence has not been verified in this run.
5. The owner PC's `C:/tmp` research paths were not accessible from the available scoped remote file interface during this run. This research artifact was prepared and tested in an isolated local workspace and must not be presented as a PC-side Native8 replay.

**Adoption decision: NOT ADOPTED. No new economic BT result. No VPS/LIVE/Production/HP/orders changes.**
