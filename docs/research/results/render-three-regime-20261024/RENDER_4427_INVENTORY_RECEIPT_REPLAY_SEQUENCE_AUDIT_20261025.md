# RENDER #4427 — Inventory receipt replay/sequence boundary audit (2026-10-25)

**STATUS: RESEARCH_ONLY_DUPLICATE_RECEIPT_ACCEPTED_BY_PRIOR_PREFLIGHT; NATIVE_ADMISSION_FAIL_CLOSED**

## Newly audited finding

The prior research-only inventory freshness wrapper checks immutable entry projection, proof bytes, digest, caller-context, as-of and age, but has no durable sequence, receipt ID or replay ledger. Re-evaluating an identical, freshly pinned synthetic candidate and inventory twice returns NEED_NATIVE_ALLOCATOR on both invocations. This is a research preflight idempotency/anti-replay contract gap; it is NOT evidence of double order placement, native allocator admission or LIVE safety bypass. NEED_NATIVE_ALLOCATOR is never an order permit.

A new research-only, ephemeral in-memory sequence/receipt guard requires source identity, monotonically increasing positive sequence, unique event ID, full immutable entry-projection SHA, candidate key, Owner/Route, inventory SHA, manifest SHA and as-of. It rejects the identical second receipt as REJECT_RECEIPT_REPLAY; old sequences as REJECT_RECEIPT_OUT_OF_ORDER; missing, altered or unbound evidence Fail Closed. It preserves prior same-symbol, pending, cooldown and stale-inventory rejects. This is NOT atomic or durable; constructing a fresh guard loses replay history, as an explicit test demonstrates. A real implementation requires an independently authenticated producer and a durable atomic sequence/dedup reservation at final native admission.

| Synthetic condition | Previous research preflight | New ephemeral guard |
| --- | --- | --- |
| First fresh candidate | NEED_NATIVE_ALLOCATOR | NEED_NATIVE_ALLOCATOR |
| Identical second candidate and pinned receipt | NEED_NATIVE_ALLOCATOR | REJECT_RECEIPT_REPLAY |
| Different candidate, older sequence | no sequence check | REJECT_RECEIPT_OUT_OF_ORDER |
| Same-symbol RENDER open position | REJECT | REJECT |
| Stale inventory | REJECT_INVENTORY_STALE | REJECT_INVENTORY_STALE |

## Candidate producer source trace

The audited research producer scripts/dd-reduction/run-render-4427-independent-profit-sell55-native8-20261024.py inserts candidates with producer-set generic_accepted=True, route_selected=True, overlay_source_current=True, priority=0, and a source_runtime_sha research label, not a signed source receipt. Source file SHA256: 88e55092bc6f699bfb9373a120d469feb65b689e0a0f4cc1c5e79d85119fa2a8. These values must not be treated as independent Native8 Owner/Route admission or authoritative inventory evidence. This audit does not establish that a separate native producer cannot exist elsewhere.

## Independent verification

- Two fresh Python processes A/B: 19/19 new synthetic tests PASS each; canonical audit JSON byte-identical.
- Regression suites per process: freshness 14, inventory binding 14, Owner/Route 14, preallocation 13, authenticity 15; all PASS.
- Total per process: 89/89 PASS.
- Canonical audit JSON SHA256: 43c12f15f17e4425065a9153606223e0392fe19fa8422ad6e6eaba36ea59cdbf.
- Audit script: scripts/dd-reduction/audit_render_4427_inventory_replay_sequence_20261025.py.
- No economic BT and no native allocator code changes.

## Decision and limitations

NOT ADOPTABLE / FAIL CLOSED. No independently authenticated Native8 inventory producer, root, 13 GateProof artifacts, durable atomic sequence ledger, Owner/Route registration or actual Aster M5 fill/funding proof was obtained in the audited research path. The 2025 Aster RENDER H1 mark gap remains. The researched historical periods are not unused OOS. 2026-05-27 must be rejected for same-symbol RENDER exposure; 2026-06-23 and 2026-06-25 must be rejected without as-of authoritative proof.

Never remove old IDLE Core _overlay_block, use future exit fields for entry priority, or bypass same-symbol, 12h cooldown, Shared Risk, Gross, Margin Guard, Kill Switch, Pending, account lock or dedup. No VPS/LIVE/Production/HP/real-order or dirty worktree changes.

## Next research step

Trace real Native8 preallocation and owner-priority producer's trust root, source identity, monotonic sequence, inventory timestamp and final allocator state transition. Bind immutable candidate + 13 proof bytes + independently pinned root + authoritative open/pending/cooldown + atomic dedup/sequence reservation. If absent, retain Fail Closed and do not run new economics as if admitted.
