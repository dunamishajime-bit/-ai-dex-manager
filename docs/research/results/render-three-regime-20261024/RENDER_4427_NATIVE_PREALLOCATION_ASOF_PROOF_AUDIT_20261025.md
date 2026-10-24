# RENDER #4427 — Native8 preallocation as-of proof boundary audit (2026-10-25)

**STATUS: RESEARCH_ONLY / PREALLOCATION_PROVENANCE_INSUFFICIENT / FAIL_CLOSED**

## New audited finding

The actual converged Native8 preallocation candidate manifests for 10bps and 30bps were read directly from two independent fresh-process runs (A/B, converged I1/I2). Each contains the same three new independent RENDER SHORT candidates, with stable entry-time candidate keys across costs.

All three candidate records contain four future-outcome fields: exit_ts_ms, exit_price, unit_price_return, and exit_reason. In all six cost/candidate combinations, exit_ts_ms > entry_ts_ms. Their presence is legitimate as a modeled closed-trade simulation payload, but these values are not available at entry and MUST NOT be used to justify entry eligibility, priority, or native as-of safety proofs. **This audit does not prove that the existing allocator actually used these future values to rank entries.**

The candidate manifest's source_runtime_sha is a human-readable research label, not a 64-character SHA256 source attestation. It cannot authenticate a Native8 runtime version or candidate-time features. No native Owner registration, owner-priority, Shared Risk, Margin Guard, Kill Switch, Pending, account lock, dedup or other thirteen required native GateProofs were authenticated from these preallocation rows.

A new read-only preallocation sidecar explicitly binds the research Owner/Route and constructs the SHA256 candidate key solely from entry-time identifiers, never from future exits. It refuses admission when primary as-of proof is absent. The sidecar does not modify the Native8 preallocation/priority pipeline, does not remove _overlay_block, does not create a live Owner registry, and never authorizes an order. Thus all three independent candidates remain REJECT_FAIL_CLOSED under the new proof-boundary check. May 27's known same-symbol position rejection remains a required invariant. June 23/25 remain unverified rather than upgraded from simulated acceptance.

## Reproduction and verified boundaries

- Read actual crypto-price-model-candidates.jsonl for converged I1/I2 from independent processes A/B at 10bps and 30bps.
- Verified raw converged decision SHA parity and byte SHA parity of candidate manifests across processes/iterations, including candidate identity.
- SHA256 of converged 10bps candidate manifest: de696304d4b281235891daf320362ef72753a89db9e052cd55322477e522f783.
- SHA256 of converged 30bps candidate manifest: 774ea47081758005e4fef56ea2b739b32e383485b4f5bf0dfe32e4666d004d78.
- Entry-time candidate keys (prefixes): fd2f6c4bb1bf, 1ad42f0c020b, dee7f0e191cc, equal at 10/30bps.
- Native gate proofs independently authenticated: 0/13, Native Owner admissions: 0.
- Synthetic tests: 13 PASS, including future-data exclusion, candidate-key stability, 0.25x cap, same-symbol rejection and non-authorization.
- Audit JSON: RENDER_4427_NATIVE_PREALLOCATION_ASOF_PROOF_AUDIT_20261025.json, SHA256 77347953161faeb2d859627eba63d92c4d51d3dcba89fb8d2aed4071f729ac99.
- Script: scripts/dd-reduction/render_4427_native_preallocation_asof_proof_20261025.py; tests: scripts/dd-reduction/test_render_4427_native_preallocation_asof_proof_20261025.py.

This is a new provenance/causality boundary audit, not a new economic backtest. Previous counterfactual portfolio gains are not re-certified. Full Native8 under an actual registered independent Owner is not tested.

## Strict limits and next requirement

The source_runtime_sha label must be replaced by independently authenticated, immutable, candidate-key-bound as-of feature evidence; owner registration and priority must be native and auditable. Position/pending/cooldown and all global risk gates must be checked against the actual native state. An independent signed/verified venue execution record is needed for Aster fill/funding parity. 2025 Aster RENDER H1 mark remains missing; historical windows have already been explored and are not unused OOS. No unverified proof may be synthesized or inferred from a modeled fill flag.

No original dirty worktree was overwritten. No VPS, LIVE, Production, HP, or actual order changes. **NOT ADOPTED.**
