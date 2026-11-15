# STABLE4 integration continuation checkpoint (2026-11-16 JST)

Continuation of the original Codex branch codex/stable4-production-integration-20261115, not a fresh implementation or Production deployment.

## Existing source and local verification

- Previous checkpoint: 8e464360144dad07847842d308cfcef2d4a5dff3.
- Preserve existing 3-layer native opportunity, H48 time-only exit / V4 preemption, and research Gross code.
- Code-level candidate limits: Crypto 3.0x, Stock 4.0x, ordinary Total 4.25x, exact V4 reservation Total exception 4.75x. This is not verified Production state.
- Local: 45 Stable4/H48 TypeScript test files, 221 passed, zero failed; main/research TypeScript typecheck PASS.
- Root source-only tests PASS. Q102 bootstrap install rollback remains deliberately skipped until source trust and writer exclusion are redesigned.

## Corrected in the same worktree

1. Runtime source manifest must receive the exact reviewed --source-sha, not a stale hardcoded 7a1e source.
2. Include Root cutover scripts and the two V4-imported JSON inputs; flag missing external Root modules and dynamic imports.
3. Root cutover source generator now packages disdex_v4_nonflat_ownership.py, which H48 signed inventory requires; an unconditional test covers this.
4. STABLE4 CI now tests Root transaction/rollback and H48/V4 interactions and uploads a review-only source manifest.

## Remaining hard gates: not READY or LIVE

- Q102: the three DRAFT_BLOCKED gates in disdex_stable4_q102_bootstrap_seal.py are intentional. Native parser source trust, old/new learning writer exclusion and data provenance must be independently completed before bootstrap installation. Do not bypass them.
- Root preimages: disdex_unified_root_gate and disdex_pending_maintenance_install are installed Root dependencies not included as Git source. Compare actual VPS bytes and approved hashes. The review inventory may contain unresolved external modules or dynamic imports. It cannot certify a complete release.
- Production state: verify current immutable pins, V4 existing protected inventory and resident STOPs, HYPE flatness, Q102 writer state, fresh signed venue evidence, Shared Risk / Gross, pending orders and service PIDs. No such verification is implied by local tests.
- Formal cutover: require final SHA + GitHub CI, exact immutable staging and marker, signed read-only VPS preflight, proper scope/plan/Owner approval, separate cutover and three advancing actual decision-cycle proofs.
- H48 time-only/no resident STOP and proposed Gross enlargement materially change the prior Production policy. Apply only with exact intended authorization.

No trade, order cancellation, position adjustment, STOP, Kill Switch, Runner activation or Production deploy was made in this checkpoint.