# STABLE4 Root / pending immutable-source closure gap (2026-11-17 JST)

## Verdict: SOURCE_NOT_CLOSED — DO NOT PROMOTE

Read-only/source-only review of the existing `codex/stable4-production-integration-20261115` candidate. Owner PC staged candidate source **was not released or pushed as functional runtime** because the full repository TypeScript contract is inconsistent. All experimental modifications were restored, and the working branch returned to clean at `252dedb86afc0096b136118327b0dd673d053f6a`.

## Provenance established

The existing `scripts/ops/root/disdex_pending_composite_upgrade.py` pins exactly seven immutable no-order pending maintenance source SHA256 values. Seven staged source files under private Owner PC `C:\tmp\stable4-pending-overlay-review-20261116-v1` were independently rehashed and **7/7 matched** the Root manifest `HASHES`. The existing Git `scripts/ops/deploy/disdex_pending_refresh.py` also matches its expected hash (`c5a7fec23b47fa3db71f6a961320b7d5f239488121dc17a9b6d325f6b557849b`).

An attempted **candidate worktree only** source assembly added five missing paths and replaced the root-owned pending readonly reconcile source with the exact expected byte stream. The original Git version was backed up to a private PC file, and no live system was touched.

Focused source validation passed:
- Root pending composite Python contracts: 8 tests PASS, 0 fail.
- Pending H48/protected-hold TypeScript contracts: 11 tests PASS, 0 fail.

However, **full repository `npm run typecheck` failed** (10 diagnostics), including:
- `lib/disdex-pending-owner-evidence.ts` requires five STOP ownership exports (`resolveResidentStopOwnerPins`, `v4ProofsFromIndependentEvidence`, `v4ProofsFromBoundLedger`, `q102ProofsFromIndependentEvidence`, `ResidentStopOwnerPins`) not exported by the current branch's `lib/resident-stop-observation.ts`.
- `lib/disdex-pending-owned-venue.ts` is missing.
- `lib/aster-readonly-evidence-fetch.ts` is missing.
- Further type mismatch/inferred `any` failures occur because of those incompatible contracts.

Two missing modules and the STOP ownership exports exist in Git history at pinned `e6afd90883544bbe9d3a6bf9e13614fa9737c65a`, **but automatic cherry-picking is not approved**: its `lib/resident-stop-observation.ts` includes historical pinned V4 and Q102 owner values and substantially differs from the current source. Mixing old STOP ownership semantics into current production without independent migration and venue proof could corrupt protection. Thus the attempted candidate source assembly was deliberately rolled back; `git status` verified clean. **A 7/7 file-hash match is not enough to establish complete dependency closure or economic safety.**

## External Root dynamic-loader targets

Owner PC private Root snapshot (`C:\tmp\stable4-root-review-20261116`) was read as data only, never imported or executed.

- `disdex_pending_maintenance_install.py` (observed SHA256 `b852b283cffb189f92be8ac50611621dff0dae3f3aa810af2022de2d5de9a1a5`) uses `spec_from_file_location`/`exec_module` on two scripts from the selected immutable release: `scripts/ops/deploy/disdex_pending_refresh.py` and `scripts/ops/deploy/disdex_pending_maintenance.py`. The latter source is absent from current Git and exists only in the private frozen overlay.
- `disdex_v4_priority_live.py` (Owner PC observed SHA256 `8d0583b454b2782b1c6530490938e7a6091d089c94079b4bce10a126c9441810`) dynamically imports `scripts/ops/deploy/disdex_v4_evidence_refresh_activation.py` from its immutable release. That helper path is not present in the current Git source inventory. The reviewed Root code also contains a pinned SDK dependency at release SHA `7b7719c65d2c6116d02463fc4603200f28e20762`, which must be independently attested rather than inherited as a valid candidate SDK.

These are explicit dependency edges missing from a review restricted to Git code imports. **Never mark the Root graph as sourceClosed merely because installed Root imports resolve**; immutable release child-module hashes, owner approval, Root execution contract and candidate owner pins must be separately checked.

## Required resolution (Codex continuation)

1. Establish a single reviewed, source-exact pending overlay package satisfying the seven Root `HASHES` **and** all transitive imports, current pinned STOP owner semantics, strict typecheck and current runner integration. Do not alter existing STOP logic by opportunistically copying the old `resident-stop-observation.ts`.
2. Recover/independently review the two missing TypeScript modules and V4 dynamic refresh helper from their exact Git/pinned-release provenance, bind reviewed SHA256 into the immutable candidate and include explicit dynamic loader tests. No private runtime secrets or root source dumps in public Git.
3. Re-run the candidate source manifest to zero unresolved imports or explicitly fail-closed review, typecheck, H48/STOP/pending regression tests, Ubuntu Root tests and fault-injection rollback. Independently verify live protected venue evidence and Owner approval before formal cutover.
4. Do not claim the current 236-file source manifest, older pinned Root snapshots, or passing partial tests prove LIVE readiness. The existing DD20% / research replay mismatch and Q102 writer/parser bootstrap hard gates remain unresolved.

Logs retained locally (not Git): `C:\tmp\stable4-pending-source-py-tests-20261117.log`, `C:\tmp\stable4-pending-source-ts-tests-20261117.log`, `C:\tmp\stable4-pending-source-typecheck-20261117.log`.

**No order, STOP, position, Kill Switch, service, VPS, owner approval or LIVE deployment changes performed.**
