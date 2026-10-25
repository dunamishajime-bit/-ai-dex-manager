# RENDER #4427 — Strict GateProof freshness and sequence boundary (research only)

Audit date: 2026-10-26 JST. This report documents a **newly reproduced synthetic research-API boundary**, not a Native8 defect or an actual trading bypass.

## New finding

The research-only strict proof function `render_4427_native_proof_authenticity_20261025.check()` authenticates canonical artifact bytes against the supplied manifest digest and checks `0 < asof_ts_ms <= candidate.entry_ts_ms`. It does **not** impose a maximum age, require all 13 proofs to share one snapshot/sequence, or require an independently verified producer identity beyond a nonempty `source` string. The existing v1 manifest and artifact schemas reject added `sequence` and `inventory_root` fields. Therefore a future implementation **cannot obtain authoritative freshness or a coherent inventory snapshot from this verifier alone**; a separately authenticated native preallocation envelope would be needed.

This is not evidence that any real Native8 proof producer emits stale data. A manifest SHA computed by the synthetic fixture is **not an independent operator trust root**.

## Pinned primary sources

- `scripts/dd-reduction/render_4427_independent_owner_route_contract_20261025.py`: SHA256 `35925b10dc29f80c6331ffcfac62ade104b499480ceb1275888c80a01df31ac2`.
- `scripts/dd-reduction/render_4427_native_proof_authenticity_20261025.py`: SHA256 `ec63c4d18e05e1a978c467284298657c584882b1291d223a81e5279c642773fc`.
- Both source files were fetched as bytes from the pinned research ref `research/render4427-gross-proof-identity-audit-20261026`, SHA-checked before evaluation. Only the pure strict-verifier AST functions were compiled; the Native8 runtime, research runner and brain were **not imported**.

## Independent owner-PC verification

The committed reproducibility script `scripts/dd-reduction/audit_render4427_proof_freshness_sequence_20261026.py` was fetched from GitHub and executed **in memory** in two independent owner-PC Python processes. No PC research file was written. Both exited 0; both ran optimize 0/1/2 and produced identical canonical JSON.

- GitHub-fetched audit script byte SHA256: `42f887c823609c82f217168368a49382248ab4cf50d0095232e9e094461c3799`.
- Canonical audit JSON SHA256 (identical twice): `24b6425fe34452a7edcf317a07691a7f180a197b5364b1daa2f2b76d6f52e889`.
- 9 synthetic cases × 3 Python optimization levels × 2 independent processes = **54 expected verdict checks**, all matched.

| Synthetic case | Strict `check()` | Meaning |
| --- | --- | --- |
| 13 near-entry proofs | Accepts | Positive control, synthetic only |
| All 13 as-of timestamps equal 1 ms after epoch | **Accepts** | No maximum proof age |
| Alternating 1 ms after epoch / near-entry as-of | **Accepts** | No common snapshot/sequence requirement |
| Arbitrary nonempty `source` labels | **Accepts** | String presence is not producer authentication |
| All as-of timestamps later than entry | Rejects | Upper bound remains enforced |
| Zero as-of timestamps | Rejects | Positive lower bound remains enforced |
| Add `sequence` to a proof | Rejects | v1 artifact schema excludes it |
| Add `sequence` to manifest | Rejects | v1 manifest schema excludes it |
| Add `inventory_root` to manifest | Rejects | v1 manifest schema excludes it |

These tests use synthetically constructed proofs and a self-computed manifest hash strictly to exercise parser and binding behavior. They are **not** 13 genuine GateProofs.

## Research integration boundary

A future research-only adapter should obtain a candidate-independent operator trust anchor, an authoritative inventory root, producer identity, strictly monotonic sequence, and bounded as-of timestamps **before** any Native8 import/patch or allocation. It should bind the exact candidate, gross, Owner/Route, open/pending/cooldown inventory, proof bytes, and allocation decision to the same immutable admission snapshot. Do not retrofit untrusted fields into the existing v1 manifest or mistake a synthetic receipt for authoritative evidence.

**Fail Closed:** genuine operator trust root absent; Native8 owner/route registration unproven; 13 native GateProof receipts unauthenticated; real allocation/priority call path unproven; no Native8 economic BT and no LIVE adoption. The research result does not relax same-symbol, 12h cooldown, Shared Risk, Gross, Margin Guard, Kill Switch, Pending, account lock or dedup controls.

No VPS/LIVE/Production/HP/orders, active eight strategies, old IDLE Core `_overlay_block`, or existing worktree was modified. Only the new isolated GitHub research branch was written.
