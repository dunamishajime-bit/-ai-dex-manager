# RENDER #4427 — Native8 effective runtime-source attestation boundary (2026-10-25)

**RESEARCH ONLY — static code-path audit. No order authorization or economic BT.**

## Newly audited finding

The #4427 independent SHORT research runner reaches a PENGU full8 wrapper that rewrites an upstream Python `main` function **in memory** using `inspect.getsource(function)`, `src.replace(old,new)`, `exec(compile(...))`, and `native.main=loc['main']`. The checked-in source of the original `main` is therefore **not byte-identical** to the source string compiled for the research runtime.

This is a deterministic, explicit research rewrite; it is **not evidence of malicious code, non-determinism, or future-data leakage**. It matters because a candidate's `source_runtime_sha` research label and a Git commit hash alone do not attest the effective runtime function and its import/patch closure.

The static import chain from the #4427 independent runner to the rewritten function was verified across **10 source files**, and each source file's byte SHA256 is recorded in the JSON artifact.

- Original upstream `main` function source SHA256: `d662f92a0d0e1afb8b1be1245681024dd0c800bab71e7db514a389faa7d6620d`
- Statically reconstructed transformed `main` source SHA256: `6eb3008a7f40bd1577d22f8daf8baa94f2a8ae0b87f1f58f81c6cf739860677b`
- Replacement target occurs **exactly once**; transformed function **compiles**.
- Research candidate producer continues to self-assert `generic_accepted=True` and `route_selected=True`; its `source_runtime_sha` is a research label, not a cryptographic digest, and its generated candidate row has no explicit `owner_id`.

## Independent verification

The read-only static auditor ran in two separate Python processes. Each run passed 4/4 assertions and produced **byte-identical** JSON, SHA256:

`18c9ede19ede0c383f8871c2e3818c3c5ad6891330ccf3af25fd5c4e6036cb84`

The audit does **not** execute the native wallet, does not claim that the compiled source is the only code executed at runtime, and does not certify LIVE/Production code. It reconstructs the exact string replacement specified in the tracked research wrapper.

## Consequence for future research

Before treating Native8's preallocation/owner-priority output as authoritative, a **trusted, independently pinned effective-runtime manifest** must bind the upstream source bytes, import chain, transformation source and transformed function digest, producer identity, immutable entry projection, inventory snapshot and 13 as-of GateProof artifacts. A self-reported candidate field is not an independent trust root.

Continue formal research-only Owner/Route design; do not remove `_overlay_block`, inject synthetic receipts as live proof, use future exit fields in entry priority, or bypass same-symbol, cooldown, Shared Risk, Gross, Margin Guard, Kill Switch, Pending, account lock or dedup.

**Existing exclusions remain:** May 27 same-symbol conflict rejected; June 23/25 lack independently authenticated native safety proofs and remain Fail Closed. 2025 Aster RENDER H1 mark coverage, actual Aster M5 fills and Funding are not certified. Explored 2025H2 is not untouched OOS. No new Forward Shadow primary evidence established by this audit.

No VPS, LIVE, Production, HP, actual orders, incumbent strategies or dirty worktrees were modified. No economic BT was run.
