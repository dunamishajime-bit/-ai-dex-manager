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
## 2026-11-16 continuation: Q102 old-writer exclusion tightened

- Independent read-only VPS inspection: old pinned Q102 ef1ab178e26a is active with MainPID 805183, cwd exactly its pinned immutable release. Existing state.json and decision-ranking-history-2026-11-16.jsonl are being updated; proposed stable4-online-state.json does not exist.
- The active old Q102 process environment has no DISDEX_STABLE4_MODE flag. Absence of an OFF flag is not evidence of writer exclusion, even when the proposed destination filename differs.
- The previously drafted assert_old_q_not_learning accepted missing DISDEX_STABLE4_MODE. Tightened it to require one and only one explicit DISDEX_STABLE4_MODE=OFF on a live old pinned process; if old service is inactive/MainPID 0 the inactive branch remains available. No new flags were installed in Production.
- Added synthetic cross-platform cases: unset, LIVE, duplicate mode, wrong release cwd fail; explicit OFF and stopped pid are accepted. Local unit 5 PASS, 1 deliberately skipped rollback test, zero failed.
- prepare/install/native_validate are still hard-blocked and were not enabled. Actual source parser trust, old writer provenance, signed protection verification, exact owner authorization and Q102 LIVE activation remain pending. This change by itself must NEVER authorize a cutover.
## 2026-11-16 research model DD independent replay audit (all 10/30bps cases)

- Executed new read-only independent checker scripts/ops/stable4_research_dd_independent_audit.py against Owner PC private one-year 2025-10-01T00:00:00Z to 2026-10-01T00:00:00Z model folders: H48, native HYPE TREND, and no-HYPE.
- 6/6 cases: complete 105121 equity samples each, strict five-minute UTC grid, first/last equity, and independent peak-to-trough maximum DD exactly reconciled to original 10bps/30bps manifests (error under 1e-6 percentage points). Historical source files named *_EQUITY_30MIN.csv are in fact sampled every FIVE minutes. Manifest field max_hourly_dd_pct also reproduces from the five-minute mark-to-market series.
- Model maximum drawdowns (absolute): H48 10bps=22.595079%, 30bps=23.219482%; native TREND 10bps=40.238797%, 30bps=27.370750%; no-HYPE 10bps=36.689914%, 30bps=23.709305%. All six exceed the Owner DD20% limit.
- Source integrity: output records the SHA256 of each original private manifest and equity CSV; checker requires both fee models, exact ending equities, positive finite MTM, and exact time grid. Missing or contradictory source evidence fails closed.
- Private evidence-only JSON: C:\tmp\stable4-independent-model-dd-audit-20261116.json (Owner PC). Do not publish private fills or replays. The code's CI tests use synthetic data and never place orders.
- Independent arithmetic audit of research is NOT a new candidate-source-integrated BT or a proof of venue economic parity. Codex candidate pin, native three-layer source, real Q102 bootstrap and owner-approved economics are not yet reproduced against real venue execution. This audit intentionally always reports BLOCKED_NONLIVE_RESEARCH_MODEL, liveCutoverAuthorized=false, and exit code 2.
- New CI regression checks research-audit contract; formal source-pinned 10/30bps walk-forward and venue parity with maximum DD <=20% remain hard gates. Production and protected positions/STOP unchanged.
## 2026-11-16 installed Root dependency graph audit and preimage copy

- Repeated owner VPS read-only SHA256 checks on the four external Root entrypoints; exact checksums match the locally captured private copies.
- Static Python AST traversal of installed Root import graph yields 21 reachable root-owned modules, 0 missing static disdex_ imports. Each of these 21 installed files was separately copied to Owner PC at C:\tmp\stable4-root-review-20261116 and re-hashed against the read-only VPS manifest with 21/21 exact matches. No remote Root service, approval, trading, filesystem or PIN mutation.
- A deeper AST-only loader audit found four load sites, across two modules: disdex_pending_maintenance_install.py uses importlib.util.spec_from_file_location and exec_module, and disdex_v4_priority_live.py uses the same two operations. Those candidate-release child files and their dependent source hash validation require separate provenance review. Thus static import existence does NOT establish a full, reviewed immutable root source closure.
- Added scripts/ops/root/disdex_stable4_root_dependency_graph_readonly.py and fail-closed synthetic regressions: missing modules, imported module name not literal, dynamic external code loaders, source hash drift, wrong paths, and symlink rejection. A complete scan is still explicitly labeled INSTALLED_ROOT_GRAPH_OBSERVED_REVIEW_REQUIRED and deploymentAuthorized=false. The private 21-module report currently reads BLOCKED_MISSING_OR_DYNAMIC_ROOT_MODULES (4 dynamic loader calls, 0 missing).
- Hardened existing disdex_stable4_root_preimage_readonly.py: the fourth externally installed source disdex_pending_maintenance_install.py now must match independently observed SHA256 b852b283cffb189f92be8ac50611621dff0dae3f3aa810af2022de2d5de9a1a5, but matching it remains OBSERVED_NOT_INDEPENDENTLY_REVIEWED, never owner approval. Changed observed source fails closed. Source-only tests are run in CI on POSIX; Windows local ownership/symlink tests are deliberately skipped.
- Candidate Git review manifest still has 5 missing local imports and 8 dynamic/unresolved path references as of bf2726d9e; versioned candidate source closure and exact customer-approved economics are not yet proven. Production systemd/STOP/positions/Shared Risk not changed.
## 2026-11-16 Q102 writer-exclusion repeatable live read-only check

- Implemented scripts/ops/root/disdex_stable4_q102_writer_readonly.py and six synthetic regressions to audit exact pinned Q102 systemd PID/release cwd, explicit old-mode OFF, destination state existence, and mismatch handling. No confidential environment values leave the host; only the DISDEX_STABLE4_MODE flag is inspected.
- An explicit OFF flag alone never certifies old/new data-writer exclusivity or source-parser trust; this tool always returns code 2, deploymentAuthorized is never granted and bootstrapInstallationAuthorized=false.
- Fresh VPS owner read-only snapshot: QUALITY102_CAUSAL_V1 pinned ef1ab178..., unit active, process cwd matches the pinned source, no explicit DISDEX_STABLE4_MODE=OFF, new Stable4 bootstrap state file absent. Result: BLOCKED_OLD_Q102_WRITER_EXCLUSION_UNPROVEN. Private evidence: C:\tmp\stable4-q102-writer-readonly-20261116.json.
- Until the old writer's actual execution path and source are reviewed, and it has been safely quiesced under the formal approved transaction without disturbing protected positions, the Q102 bootstrap prepare/install remain deliberately DRAFT_BLOCKED. The public Root signer and owner formal gate cannot be bypassed.
## 2026-11-16 immutable source inventory explicitly blocks false LIVE readiness

- Extended the existing scripts/ops/build_stable4_runtime_source_manifest.py rather than creating a second release packaging path. Its Git-blob-reviewed candidate manifest now explicitly records the two observed external Root module hashes, externalRootIndependentlyReviewed=false, sourceClosureCertified=false, productionEconomicParityVerified=false, signedVenueEvidenceVerified=false, ownerApprovalVerified=false, and productionReady=false.
- The source graph status separately distinguishes GIT source imports/dynamic references from installed but unreviewed VPS root modules. The unresolved imports and dynamic paths must not be silenced or marked certified by matching a local file name.
- Added a source-only CI regression proving that an unresolved/dynamic graph refuses creation of any archive, preserving the previous fail-closed archive behavior. This remains review data, not a production installer.
- Q102 bootstrap installed-state and Native parser/provenance gates remain blocked; only the original Codex branch was changed and GitHub Push is required per task.
## 2026-11-16 immutable Stable4 Gross vs original model manifests (hard blocker)

- Added scripts/ops/stable4_gross_policy_parity_gate.py to read the exact reviewed Git commit source for config/disdexStable4Opportunity.ts (no execution of candidate TS code), extract Crypto, Stock, Total and V4 Total exception maxima, and independently compare all 10bps and 30bps research manifest rows. Source SHA, manifest SHA256, missing and changed values are recorded. Five source-only tests PASS.
- Candidate commit 05d28e10255ecc1ff9b613e18b4d4a0a148c5ef3 declares cryptoGrossCap=3.0, stockGrossCap=4.0, totalGrossCap=4.25, v4TotalGrossCap=4.75.
- All six original private 2025-10-01 to 2026-10-01 research cases (H48, native TREND, no HYPE; 10bps/30bps) report crypto_cap=3.0, stock_cap=1.5 and total_cap=3.5. They do NOT report a distinct v4_total_cap. Each of the 6 source manifests therefore differs from / lacks the candidate's source risk contract in exactly three cap fields.
- Every real run returned BLOCKED_CANDIDATE_GROSS_NOT_REPLAYED and intentional nonzero exit 2. Even matching numerical caps would NOT prove exact native pin, volume, venue fill, STOP, original H48 time-only authority, or Owner approval.
- Private evidence JSON: C:\tmp\stable4-gross-policy-source-parity-20261116.json. No private model fills/transactions transmitted to GitHub. CI tests synthetic data only. V4/Gross policy has NOT been changed on VPS.
- A new full-year source-exact candidate integrated BT for both 10bps and 30bps, independent OOS and max DD<=20%, followed by signed live venue evidence and explicit Owner-approved Gross/H48 no resident STOP contract, remains required. Old DD calculations cannot serve as production economic-parity certification.
## 2026-11-16 new full-year exact-cap research rerun and signed venue audit

- Research wrapper original: C:\tmp\disdex-bt-20251001-20261001\DIRECTION_RESEARCH_20261109\STABLE3_REPRO_RECOVERED_20261113\portfolio_three_layer_l3_q102_dualhealth_clean_20261114.py. SHA256 1971e1d403ad871ca564fe7409e845cd1ec51ec3c84678dcabddefc9f3a63050; canonical source SHA256 eba62b627ae78929de28a3274e9afadaf5204af05527996c47ce7ef6b14018c6.
- A non-live copy with a distinct output case name only, portfolio_stable4_gross425_v4_475_l3_q102_h48_20261116.py, SHA256 595fcf25a164392d70f156738c595f2af2697817166255bed2a6aa85b2cbd7f7, was executed using DISDEX_Q102_ADOPTED_MODE=ON, DISDEX_PRETARGET_STABLE_CASE=STABLE3 and a minimal local process environment. Generated research engine SHA256 f2edd70a9eb7ce2f1efde1b34a935324837bc3d689c29e4e6e5bec9eb91d8290.
- Private source/replay directory C:\tmp\disdex-bt-20251001-20261001\STABLE4_GROSS425_V4_475_L3_Q102_DUALH48_RESEARCH_20261116_V1. Never copy trading ledgers to public Git.
- 2025-10-01 00:00 UTC to 2026-10-01 00:00 UTC, JPY 10000 starting equity, separate 10bps/30bps. Source research Crypto 3.0x, Stock 4.0x, ordinary Total 4.25x, V4 special total 4.75x; last special exception is in source and not separately present in run manifest.
- 10bps: 795 model fills, win 63.899371%, maximum DD -21.571152%, compounded JPY 13,541,227.42. 30bps: 791 model fills, win 61.820480%, maximum DD -22.281591%, compounded JPY 4,923,411.54. Independent 105121-point 5-minute time-grid and peak-to-trough calculation PASS; both models FAIL desired DD<=20% gate.
- Private manifest SHA256 36229cf7f8b399339e09fc6c0c3c6a74a219f91e84324313f460a41eadcff7a2; 10/30bps MTM CSV SHA256 404f2fd7126b1838725769e463936366ec6de5176528bb4b45cb9c9329fbcf3f and 3903d601f33a66e6fd5cccfa10ca1081a8294a4cab1711e3f8e3d52f55f54845. 10/30bps fill ledger hashes cd492d4c847f812b6fd89711a8d86ce3f5ecb6b307e140ea6f52f17ac69a8676 and 6d884fe3d200faf9715a0bd4f8f5531550d3ce443cd273d38a89380aeb764f24.
- Both troughs occur 2026-03-09T02:05:00Z after a late-February peak. 2 modeled positions open at trough: Q102 AVAX LONG 0.75x and V52 NVDA LONG 2.0x. Model realized pnl alone cannot establish per-position marked-to-market DD contribution. Altering rules based on one target-year trough could overfit.
- In a separate live read-only Aster V3 signed GET-only request, pinned V12_V4 e788abc82e80f9fc7ab0e1ba83fdb8be267eb513 currently has 1 SOLUSDT position and 1 live resident STOP order. Pure Python V4 inventory versus actual signed rows passed. Endpoint allowlist only permitted /fapi/v3/time, /positionRisk, /openOrders GET. New orders/cancels/position changes: 0. This does NOT constitute independent journal replay, H48 policy/no-STOP approval, Q102 cutover, owner token, or full risk parity.
- Despite candidate-sized Gross caps, this remains research-only. HYPE replay assumptions, V52 price proxy and missing V11 source, fills, source-pinned Q102, and candidate exact-entry parity are unresolved. No new BTC/alt strategy live trading is authorized. Full source-exact candidate 10bps/30bps OOS and DD<=20% proof still pending.