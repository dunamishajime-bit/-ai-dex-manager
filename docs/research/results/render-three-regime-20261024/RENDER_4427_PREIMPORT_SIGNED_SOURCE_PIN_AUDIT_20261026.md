# RENDER #4427 — independently pinned preimport source verification (research only)

**2026-10-26 / STATUS: PARTIAL_SIGNED_SOURCE_PIN_RESEARCH_ONLY / NATIVE8_BLOCKED**

## New engineering result

A new *separate* research-only preimport verifier checks a detached Ed25519 signature on canonical JSON, a SHA256 fingerprint for a public key supplied independently of the candidate, an exact operator-specified set of source component roles, the actual bytes of each pinned file, output-path containment, and deterministic one-occurrence literal source rewrites with independently signed expected post-patch SHA256 values. It never imports/executes any target module, mutates global research functions, creates directories, or grants Native8 order permission.

This addresses an important part of the previously unbound source/patch identity problem: a caller cannot silently change a signed manifest, swap a pinned source file, omit a required role, change the intended output path, or change the deterministic patch result without the verifier rejecting the input. Unlike an ordinary Git SHA label, this checks bytes and the signature. However, the actual authenticity of the trust root depends on *independent operator provisioning* and is **not** established by this experiment.

## Independent verification

The two new GitHub files were fetched to the owner PC's permitted user-root research folder `C:/Users/dis/render4427-research-only/signed-closure-20261026`. Six independent Python test processes (normal, `-O`, `-OO`, twice each) passed 12/12 tests, **72/72 total**. Tests cover valid synthetic signature, absent/wrong external key pin, invalid/tampered signature, incomplete component set, source byte drift, output path escape, missing dynamic transform, duplicate replacement hook, incorrect transformed SHA, and subject mismatch. The synthetic private keys exist **only inside tests** and must never be accepted as an authentic Native8 signer.

PC-fetched source SHA256: `546e8ad5c86e57ddda00b6d5983f8df2c259b7c2628c46ff5a8761e317281ac2`.
PC-fetched test SHA256: `5dfd94378cf1f3705501ee41efdf48eb5e8fcff636a49978eb47f2a03602e251`.
Canonical six-run result SHA256: `a65833017f52751a20011a64608f712d4a1256e13df72508a65ea0900ced81a6`.

## Strict non-certification

This is **not** a genuine independently provisioned Native8 trust root: no externally controlled public key or signature for the real external task8 sources, fourth-root modules, Git-external brain, shadow bank, or complete runtime closure was obtained. The verifier does not prove closure completeness for arbitrary dynamic imports, `inspect.getsource`, `exec`, or module-scope monkey patches. It returns `complete_dynamic_import_closure_authenticated=false`, `gateproofs_authenticated=0`, `native_owner_registered=false`, and `order_authorized=false` even for a synthetically valid manifest.

No real 13 GateProof producer, authoritative inventory/source identity/sequence/freshness, distributed dedup, or native Owner/Route registration was certified. No Native8 10/30bps economic replay was run. The previously modeled May/June candidate outcomes are not reinterpreted as venue evidence; historical exploration is not pristine OOS.

## Isolation

Only two new research scripts and this report/evidence JSON are added on the new GitHub research branch. On the owner PC, only the explicitly permitted new user-root research folder was written; `C:/tmp`, existing dirty worktrees, old IDLE `_overlay_block`, the current eight strategies, VPS, LIVE, Production, HP and actual orders remain unchanged.

## Next

Find an actual candidate-independent operator trust root and an authoritative source for full runtime import/patch closure, including the two Git-untracked task8 files, third/fourth roots, Git-external brain/bank and import-time function substitutions. Bind the native 13 GateProofs and monotonic inventory snapshot to the full candidate key (including entry price and gross) before any allocator integration. Until then: **Fail Closed; NEED_NATIVE_ALLOCATOR is not a permit.**
