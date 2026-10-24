# RENDER #4427: Native GateProof authenticity boundary audit (2026-10-25)

**Status: RESEARCH_ONLY_PROOF_AUTHENTICITY_GAP_CONFIRMED_FAIL_CLOSED**

## New, independently reproduced finding

The existing research-only `GateProof.valid()` accepts a 64-character hexadecimal `source_sha256` on **format alone**. It does not read or hash the alleged source artifact and does not verify an independently trusted root. A fabricated `"a" * 64` value supplied for each of the 13 required proofs, with matching as-of timestamp and candidate key, makes the old pure preflight return `NEED_NATIVE_ALLOCATOR`.

This is a **research preflight evidence-authenticity gap**, not a demonstrated LIVE security bypass: `NEED_NATIVE_ALLOCATOR` is not an order permission; `native_order_authorized` remains false, and this test does not invoke the actual Native8 allocator.

A second newly confirmed binding gap is that the old `Candidate.key()` excludes `requested_gross`. The same candidate key is produced for a 0.25x and 0.05x request. Consequently, a proof keyed only to that hash is not sufficient to bind the requested capital amount. The new strict verifier binds `requested_gross` separately to both the trusted manifest and every gate artifact.

## Research-only strict verifier

New `render_4427_native_proof_authenticity_20261025.py` requires:

1. An **independently pinned** manifest SHA256; self-reported hashes in candidate rows or the manifest are not a trust root.
2. Exact byte-for-byte SHA256 matches for the manifest and **all 13** native gate artifacts, using canonical JSON with duplicate-key rejection.
3. Exact route, owner, capital-owner, candidate-key, requested-gross, gate name and entry-time binding; as-of timestamps cannot be later than entry.
4. Explicit allowlists of manifest and proof fields; no future exit outcome fields.
5. Native position, pending and cooldown checks are preserved after proof validation.
6. Even when **synthetic test fixtures** pass every check, the result is only `NEED_NATIVE_ALLOCATOR` with `native_order_authorized=false`.

**Limitations:** A trusted manifest hash supplied by the caller is not inherently authenticated. It must be pinned and independently authenticated by the trusted runtime/operator, not derived from the same untrusted candidate. No such real Native8 trust anchor was found in the inspected candidate/decision artifacts. The strict verifier does not claim to establish LIVE source signatures, exchange fills, or the provenance of an unverified root. The legacy candidate key also omits entry price; a future real Native8 integration must bind a complete immutable entry projection (price, signal time, gross, route, owner) to its source.

## Reproduction and native data

- Reproduction: fabricated 13/13 digest-shaped proofs -> old preflight `NEED_NATIVE_ALLOCATOR`, no order authorization.
- Strict verifier synthetic tests: **15/15 PASS** (including fabricated digest, trust root missing, tampering, duplicate JSON keys, future fields/timestamps, gross reuse, same-symbol, pending, cooldown).
- Existing preflight contract tests: **14/14 PASS**; previous preallocation tests: **13/13 PASS**.
- Read-only A/B converged Native8 candidate manifests, both 10bps and 30bps: three #4427 independent candidates each. Because trusted native manifest bytes/externally pinned root are missing, **all 3/3 per cost are rejected**. This does not imply proof artifacts are absent elsewhere.
- Two separate audit processes produced identical JSON SHA256: `fa8d1b29460d8ed24a05c6e6e507460184f7731c6d3f88c3d3e0a65d62dc1e46`.
- New Native8 economic replay **not performed**. No independent Owner/Route admission or allocation certification.

## Research decision

**Fail Closed.** Do not treat digest shape or a model `quantity_actual_fill` flag as native authentication. Do not bypass `_overlay_block` or any same-symbol, cooldown, Shared Risk, Gross, Margin, Kill Switch, Pending, account lock or dedup gate. No new #4427 trade is approved.

2025 Aster RENDER H1 mark history remains incomplete; actual Aster M5 fills and Funding are not certified. All researched historical periods, including 2026 Aug-Oct, are previously viewed and not pristine OOS. No VPS/LIVE/Production/HP/real orders changed.

## Files

- `scripts/dd-reduction/render_4427_native_proof_authenticity_20261025.py`
- `scripts/dd-reduction/test_render_4427_native_proof_authenticity_20261025.py`
- `scripts/dd-reduction/audit_render_4427_proof_authenticity_boundary_20261025.py`
- `docs/research/results/render-three-regime-20261024/RENDER_4427_PROOF_AUTHENTICITY_BOUNDARY_AUDIT_20261025.json`
