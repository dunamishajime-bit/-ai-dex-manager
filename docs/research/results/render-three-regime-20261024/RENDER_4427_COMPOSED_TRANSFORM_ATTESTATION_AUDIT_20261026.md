# RENDER #4427 — sequential transform attestation gap (research only)

Date: 2026-10-26. Status: **RESEARCH_SYNTHETIC_COMPOSED_TRANSFORM_GAP_CONFIRMED**.
Scope: GitHub isolated research branch and authorized PC research-only directory. No production changes.

## New finding (not previously notified)

The prior signed pre-import verifier `render4427_preimport_signed_closure_20261026.py` accepts a signed manifest with **two literal transforms targeting the same source role**. It independently hashes each transform applied to the **original source**. It does not attest the hash of the **ordered, composed output** after applying both transforms. Its return value remains explicitly partial and `order_authorized=false`; therefore this is a *research attestation completeness gap*, **not evidence of a Native8 or live-order bypass**.

The synthetic source `A=1\nB=1\n` with two disjoint replacements demonstrates that both individually expected hashes verify, while the composed-final SHA256 is absent from the signed manifest. Two independent PC Python processes reproduced the same canonical JSON (SHA256 `469a2706b1956df0b23d0debed519daa2f3012cfeea95bdc93212c301b8bcd70`). The original verifier source was checked against the GitHub-reported prior bytes (SHA256 `546e8ad5c86e57ddda00b6d5983f8df2c259b7c2628c46ff5a8761e317281ac2`).

## Research-only mitigation

A separate, non-executing `render4427_signed_composed_patch_research_20261026.py` checks a signed ordered transform plan against **one immutable input byte snapshot**, verifies every stage SHA256, verifies a signed final SHA256, and separately checks an externally supplied final-hash pin and public-key fingerprint. It never imports/executes target modules, mutates globals, writes files, or authorizes orders.

The test file `test_render4427_signed_composed_patch_research_20261026.py` passed **14 tests × 3 Python optimization modes × 2 independent processes = 84/84 PASS** on the authorized owner PC. The modes were normal, `-O`, and `-OO`. Synthetic cases include ordered composition, reordered steps, bad stage/final hash, wrong external pins, source drift, missing/duplicate hooks, signature tampering, and missing steps. An initial test-fixture mistake (second-step old literal still present) was corrected; only final passing results are accepted.

Reproduction: `audit_render4427_composed_transform_gap_20261026.py --scratch-dir <authorized-research-only-directory>`. The reproduction script imports the prior **research verifier**, not Native8, and creates only synthetic scratch files inside the supplied research directory.

## Unresolved and explicit Fail Closed boundaries

The signer in all tests is **synthetic**, not a candidate-independent operator trust root. The signed composed plan is not a complete dynamic import/patch closure, does not freeze runtime paths or prove absence of module-scope monkey patches, and is not wired to the real Native8 preallocation/owner-priority pipeline. Native8 inventory/source identity/monotonic sequence/as-of/freshness/atomic dedup, real 13 GateProofs, and formal Owner/Route remain unverified. Real Aster M5 execution/funding and missing historical H1 marks remain unverified. No 10/30bps economic Native8 replay or new Forward Shadow certification was performed.

`order_authorized=false`, `native_allocator_authorized=false`, `gateproofs_authenticated=0`. Never promote modeled entries to actual orders. Do not bypass same-symbol positions, 12h cooldown, Shared Risk, Gross, Margin Guard, Kill Switch, Pending, account lock or dedup. No VPS/LIVE/Production/HP/order/current-eight-strategy/old IDLE Core changes.

Next: obtain an independent operator-signed *complete* runtime closure (including untracked task8, external brain/bank, third/fourth roots, module-scope mutations, runtime and output paths), and trace authoritative Native8 preallocation and GateProof generation before any economic replay. Do not treat self-reported roots or synthetic receipts as real authentication.
