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
## 2026-11-16 continuation: independent read-only Root baseline recheck

- This is continuation on the unchanged Codex worktree/branch, not a new release or LIVE change.
- Owner VPS read-only SSH audit verified the *installed* active Root modules:
  - disdex_hype_scoped_root_cutover.py SHA256 710ae088dcb9a8a2793bd3890f276696dd2ae3cddebe365757bcda6c5eb80882 matches H48 reviewed baseline.
  - disdex_unified_root_gate.py SHA256 dd8ea03b2d890c355050e5d029f0fc74dbc101ae37ab766907c108966c25f529 matches H48 reviewed baseline.
  - disdex_v4_venue_witness.py SHA256 99c224070708f4714090e1dfb969ffbec41b12a5933bf37c22373a55cdba6c3c matches composite reviewed baseline.
  - disdex_pending_maintenance_install.py SHA256 b852b283cffb189f92be8ac50611621dff0dae3f3aa810af2022de2d5de9a1a5 was *observed*, not independently source-reviewed, so it does not certify external dependency closure.
- Added scripts/ops/root/disdex_stable4_root_preimage_readonly.py and source-only unit tests. This never imports inspected Root code, never changes production, rejects swapped/writable/missing source, and returns nonzero even when all three base digests match: external provenance and authorizations are still outstanding.
- PC Windows Python unit: 2 cross-platform contracts passed; seven POSIX permission/symlink tests are skipped locally by design and must run on Ubuntu in GitHub CI.
- Explicit candidate source inventory at bf2726d9e: 236 Git blobs; 5 unresolved local imports and 8 dynamic/unresolved paths. The release is NOT dependency-closed. No archive or Production promotion was authorized by this inventory.
- Production observation: pins V12_V4=e788abc82e80, QUALITY102_CAUSAL_V1=ef1ab178e26a, HYPE_TREND_LONG=a7eee1f91d86, SHARED_CRYPTO_RISK=2737c30e1f6d; all four unit states active/running at audit time. Q102 Stable4 online state file is not present.
- No venue signed protection proof was generated, no Q102 writer exclusion or source-parser trust was approved, no H48 time-only exit or enlarged Gross authorization was established, and no Runner, STOP, position, order, Owner approval or VPS code changed.
- Next: independently review external Root source and dynamic imports; redesign Q102 state install with fully isolated old writer and trusted parser; verify protected inventory via signed venue GET; verify Gross/Shared Risk and the exact Owner-approved economics; then formal staging and approval route. Fail closed meanwhile.