# RENDER #4427: inventory context binding audit (2026-10-25)

**Status: RESEARCH_ONLY_INVENTORY_CONTEXT_UNBOUND_FAIL_CLOSED**

## New independent finding

The prior strict 13-GateProof authenticity verifier checks the proof bytes and a pinned manifest digest, but its final assess_with_trust method accepts open_symbols, pending_symbols and cooldown_until_ms from the caller separately. Those three context values are **not bound to the authenticated 13 artifact bytes or the manifest**.

With the **same candidate, same manifest bytes, same 13 proof bytes and same SHA256 roots**, a synthetic test returns NEED_NATIVE_ALLOCATOR when the caller passes empty open positions and REJECT when the caller passes an open RENDER position. Equivalent differences arise from caller-provided pending symbols or cooldown. This is a research preflight context-binding gap, **not evidence of a LIVE Native8 safety bypass**; NEED_NATIVE_ALLOCATOR does not authorize orders.

## New research-only sidecar

A synthetic-only inventory binding check requires a separately pinned inventory snapshot SHA256, exact canonical inventory bytes, as-of timestamp no later than entry, full immutable entry projection including signal time, entry price and requested gross, and exact agreement between snapshot and all caller-provided position/pending/cooldown values. It preserves the prior 13 GateProof checks and existing reject behavior. No native inventory trust root or venue evidence was obtained. Independently pinning a digest is necessary but not sufficient to prove a real producer's authenticity.

Synthetic tests: 14 cases covering old contradictory-context behavior, missing/tampered root, same-symbol/pending/cooldown, entry-price mutation, future snapshot and clean fixture. Reproduce audit JSON twice in fresh Python processes and compare SHA256.

## Decision

FAIL CLOSED. No new Owner/Route registered, no Native8 economic BT, no actual Aster fills or Funding verified. 5/27 position conflict remains rejected; 6/23 and 6/25 remain unapproved without native as-of evidence. No _overlay_block change, no VPS/LIVE/Production/HP/real-order change. 2025 Aster RENDER H1 mark history remains incomplete; explored historical intervals are not pristine OOS.

## Files

- scripts/dd-reduction/audit_render_4427_inventory_context_binding_20261025.py
- docs/research/results/render-three-regime-20261024/RENDER_4427_INVENTORY_CONTEXT_BINDING_AUDIT_20261025.json

## Reproduction evidence

- New synthetic boundary tests: 14/14 PASS in each of two independent Python processes.
- Previous regression suites: 15/15, 14/14, 13/13 PASS.
- Identical independent audit JSON SHA256: 39ce2dfed582596d29d345986266a2fde3b1ca4d262e02d206984d80b676891d.
- These are synthetic consistency tests, not actual Native8 allocation or safety certification.
