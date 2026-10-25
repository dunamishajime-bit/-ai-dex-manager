# RENDER #4427 — inventory freshness boundary audit (2026-10-25)

**STATUS: RESEARCH_ONLY_STALE_INVENTORY_ASOF_ACCEPTANCE_FOUND; FAIL CLOSED FOR NATIVE ADMISSION**

## Newly audited finding

The previous synthetic inventory-context sidecar authenticates canonical inventory bytes against a separately supplied SHA256 and binds them to the immutable entry projection. Its as-of test, however, only enforces 0 < inventory.asof_ts_ms <= candidate.entry_ts_ms. It does **not** establish that the inventory snapshot is recent enough for the candidate's entry decision or that it is newer than the signal.

Using an otherwise unchanged synthetic candidate, 13 synthetic GateProof bytes, immutable entry projection and independently supplied digest, we moved only the inventory snapshot's asof_ts_ms to **24 hours before entry**, recomputed the synthetic snapshot digest, and retained an empty open/pending inventory. The previous sidecar returned NEED_NATIVE_ALLOCATOR. This proves a **stale-snapshot acceptance in the research preflight contract**, not that a real Aster or Native8 safety gate can be bypassed. NEED_NATIVE_ALLOCATOR is not an order authorization.

A new **research-only** wrapper rejects an inventory timestamp before signal_ts_ms or older than 300,000 ms (five minutes) at entry. The five-minute threshold is a conservative research policy, **not a validated LIVE/native SLA**. Existing proof-byte, immutable-entry, same-symbol, pending, cooldown and caller-context checks remain in force. Missing evidence continues to Fail Closed.

| Synthetic test | Previous research sidecar | New research freshness wrapper |
| --- | --- | --- |
| Inventory as-of entry minus 24h; all other fields pinned | NEED_NATIVE_ALLOCATOR | REJECT_INVENTORY_STALE |
| Inventory as-of entry minus exactly 5m | NEED_NATIVE_ALLOCATOR | NEED_NATIVE_ALLOCATOR (preflight only) |
| Inventory as-of entry minus 5m and 1ms | NEED_NATIVE_ALLOCATOR | REJECT_INVENTORY_STALE |
| Same-symbol RENDER position | REJECT | REJECT |
| Future snapshot | REJECT_INVENTORY_ASOF | REJECT_INVENTORY_ASOF |

## Reproduction and regression

- New independent Python-process runs: **14/14 tests PASS in each process**; canonical JSON byte content identical.
- Prior inventory binding: **14/14 PASS**.
- Prior Owner/Route contract: **14/14 PASS**.
- Prior native preallocation as-of proof: **13/13 PASS**.
- Prior proof authenticity: **15/15 PASS**.
- The proof-authenticity audit itself was rerun, but is not a Native8 economics replay.
- Canonical audit JSON SHA256: 25eeeaffa3093bc484335d08f5ee2c20ca20782619a88c8858510fb9c939745b.
- Research script: scripts/dd-reduction/audit_render_4427_inventory_freshness_20261025.py.
- JSON: docs/research/results/render-three-regime-20261024/RENDER_4427_INVENTORY_FRESHNESS_AUDIT_20261025.json.

## Native8 adoption decision

**NOT ADOPTABLE.** This is a synthetic preflight-contract finding, not an authenticated Native8 inventory receipt or new economic backtest. A digest supplied by the same untrusted research producer is not an authoritative trust root. Actual Native8 candidate-key-bound owner registration, 13 proof artifacts, authoritative as-of inventory producer, snapshot freshness/sequence, and final allocator admission remain unproven. 2026-05-27 RENDER position conflict remains a mandatory rejection; 2026-06-23 and 2026-06-25 must Fail Closed without native evidence.

The 2025 Aster RENDER H1 mark gap and unverified Aster M5 fills/funding remain. Historical windows have been explored and are not pristine OOS. Do not change old IDLE _overlay_block, same-symbol position/pending constraints, 12h cooldown, Shared Risk, Gross, Margin Guard, Kill Switch, account lock or dedup. Do not infer real-order safety from synthetic tests.

No Native8 economic BT, Owner/Route registration, LIVE, VPS, Production, HP, real-order or original dirty worktree changes were made.

## Next research requirement

Locate an **independently trusted, authoritative native inventory producer** that emits immutable candidate-key-bound snapshots at the admission instant, with source identity, sequence, event-time, observed open positions, pending orders and cooldown state; then verify freshness against the actual engine's timing contract before any research-only Owner/Route integration. Do not fabricate missing source receipts.
