# RENDER #4427 — Gross identity vs proof binding (research only)

Audit date: 2026-10-26 (JST). Scope: **new isolated research branch only**. No changes to VPS, LIVE, Production, HP, orders, eight active strategies, `_overlay_block`, or any existing worktree.

## Newly verified boundary

The research-only `Candidate.key()` identifies a signal without `requested_gross`. `GateProof.valid()` checks the candidate key, timestamp, and a syntactically valid digest, but not the requested gross. Thus the pure preflight `assess(candidate, context)` can reuse the **same synthetic GateProof objects** across different in-range gross amounts and return `NEED_NATIVE_ALLOCATOR`.

By contrast, the existing stricter `render_4427_native_proof_authenticity_20261025.check()` binds the gross to both the trusted manifest and each proof artifact. Reusing a manifest for a changed gross is **rejected** with `TRUST_MANIFEST_BINDING_MISMATCH`. Therefore this is a **research preflight API boundary / potential integration misuse**, not a demonstrated bypass of the stricter check or the real Native8 allocator.

No tested path returns order authorization; `native_order_authorized=False` remains invariant. The synthetic `source` label and the test-created manifest SHA are **not genuine independent trust roots or native proof receipts**.

## Exact primary source

- `scripts/dd-reduction/render_4427_independent_owner_route_contract_20261025.py`: SHA256 `35925b10dc29f80c6331ffcfac62ade104b499480ceb1275888c80a01df31ac2`.
- `scripts/dd-reduction/render_4427_native_proof_authenticity_20261025.py`: SHA256 `ec63c4d18e05e1a978c467284298657c584882b1291d223a81e5279c642773fc`.
- Source ref: `research/render4427-verified-byte-consumption-boundary-20261026`. Both fetched as real bytes, pinned before any isolated evaluation.

## Independent owner-PC reproductions

The committed reproducibility script `scripts/dd-reduction/audit_render4427_gross_proof_identity_20261026.py` was fetched from GitHub and executed **in memory** on the connected owner PC, twice as separate Python processes. The script does not import or execute Native8/runner/brain, write local files, or touch the live account. The owner contract was checked for allowed module-scope AST node classes before its pure definitions were compiled; the strict proof verifier's four pure functions were extracted by AST, without running its module-level imports.

- Committed audit script SHA256: `205fa4c73cff40ece3296ef7abad571b719181bce3d4d01887bd2b2ab11a0586`.
- Two independent processes: exit 0; each tested compile `optimize=0,1,2`.
- Canonical audit JSON SHA256: `702b900889d9eb0a4a9aa738714d1dc6f22af92ad64fb231d3f85ae5e0fb5249` (identical in both processes).

| Synthetic requested gross | Candidate key relative to 0.25 | Pure `assess()` | Strict `check()` with 0.25 manifest |
| --- | --- | --- | --- |
| 0.25 | same | NEED_NATIVE_ALLOCATOR | accepts synthetic artifact set |
| 0.125 | same | NEED_NATIVE_ALLOCATOR | **rejects gross mismatch** |
| 0.01 | same | NEED_NATIVE_ALLOCATOR | not separately tested |
| 0.26 | same | REJECT (cap) | not separately tested |

The strict acceptance of the synthetic fixture is a **test of parsing and binding**, not proof of operator provenance or Native8 GateProof authenticity. Both `assess()` and strict `check()` are research-side code; real Native8 call paths have not been authenticated.

## Integration requirement / next research

Preserve signal identity separately from **allocation identity**. A future research-only adapter should bind exact gross, candidate key, owner/route, authoritative as-of sequence, proof artifact digests, and inventory snapshot into one immutable admission receipt. Any gross adjustment after proof generation must revalidate the proof/receipt before native preallocation. Do not change the historical candidate key format in place or bypass the existing strict check. Investigate actual Native8 call sites and independent operator trust roots first; neither a synthetic signed receipt nor an in-memory PASS can establish them.

**Fail Closed:** no authenticated Native8 owner/route, no genuine independent trust root, no verified thirteen GateProofs, no Native8 economic BT, and no LIVE adoption. Same-symbol, 12h cooldown, Shared Risk, Gross, Margin Guard, Kill Switch, Pending, account lock, and dedup remain mandatory.
