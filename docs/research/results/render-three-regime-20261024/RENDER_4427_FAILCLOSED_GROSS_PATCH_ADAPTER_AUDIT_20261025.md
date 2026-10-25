# RENDER #4427 — fail-closed Gross source rewrite adapter (research only)

**2026-10-25 / STATUS: SYNTHETIC_ADAPTER_VERIFIED_NATIVE8_NOT_AUTHORIZED**

## New verified engineering result

The previously observed Gross source rewrite guarded two literal hooks with Python `assert`, which disappears under optimization. A new **separate pure research adapter** checks *both* exact old-hook counts before replacing either string, uses explicit `raise ResearchPatchRejected` for all anomalies, and rejects already-patched inputs. It never imports or executes Native8 or the legacy Gross source, and never installs monkey patches. It is **not wired** to the upstream runner or allocator.

The two observed source hooks are the exact `requested = 1.0` and `elif room + 1e-9 < 1.0:` lines from the read-only owner-PC source inspection. The new adapter preserves the prior replacement text for research parity but does not attest its economic correctness.

## Independent synthetic verification

Two separate owner-PC Python processes each compiled and ran the adapter and test suite with `optimize=0`, `optimize=1`, and `optimize=2`. Each of the six runs passed **5/5 unit tests** (30/30 test executions). The same eight synthetic source cases produced identical outcomes: one valid input accepted; missing/duplicate hooks, already-rewritten hooks, and CRLF source rejected. Non-string inputs and repeat application were rejected. No bytecode `LOAD_ASSERTION_ERROR` or dynamic eval/exec calls exist in the adapter function.

Canonical synthetic matrix SHA256: `c5996cc59f3b37d00fd2ffc5902cb4a6d126d89a8338ee91e21c8b0091cdcec7`.

Tests initially failed because the in-memory test harness attempted to inspect an unbacked module and a test newline was malformed. Both **test-only** problems were corrected before the successful independent runs. No legacy research source or active runtime was modified.

## Authorization boundary

This is a **pure source-rewrite safety component**, not independent attestation of the actual running source. In particular, the caller can still supply untrusted source; no independent pinned trust root, complete dynamic import/patch closure, producer inventory, monotonic sequence, 13 GateProof, native owner-priority allocator, distributed dedup, or authoritative Forward Shadow was established. Do not treat synthetic inputs or self-reported SHA as real Native8 proof. Do not change `_overlay_block` or permit orders. The research route remains **NEED_NATIVE_ALLOCATOR** even after all prerequisites pass.

The 5/27 same-symbol conflict remains rejected; 6/23 and 6/25 modeled entries remain unauthorized without native evidence. No 10/30bps economic replay was attempted. No existing worktree, VPS, LIVE, Production, HP, current eight strategies, or orders were touched. `C:/tmp` was not written because the PC connector did not authorize that path; owner-PC tests ran in memory only.

## Files

- `scripts/dd-reduction/render4427_failclosed_gross_patch_adapter_20261025.py`
- `scripts/dd-reduction/test_render4427_failclosed_gross_patch_adapter_20261025.py`
- This report and its adjacent JSON.

## Next audit

Establish a **candidate-independent** source of authority for preimport pins covering untracked task8 sources, the fourth-root dynamic rewrite and monkey-patched functions, import-time side effects, runtime path and output path. Trace native inventory and 13 GateProof generation, source identity, monotonic sequence, as-of/freshness, and durable dedup. Never rank entry candidates using future exits. Only after authentic evidence exists, run independently reproducible 10/30bps Native8 economic comparisons.
