# STABLE4 pending no-order source compatibility integration — candidate only (2026-11-17 JST)

## Candidate scope

This change assembles the frozen **no-order pending maintenance** source dependencies into the STABLE4 candidate repository and retains the existing resident STOP observation behavior for its original five-argument caller. It is **NOT a production deploy, Root upgrade authorization, STOP mutation, Writer cutover or LIVE approval**.

Starting branch baseline: `722928e446d3f3fc2a80a18f13ad613390074a21`, clean and equal to remote before editing.

## Exact source provenance

- `scripts/ops/root/disdex_pending_composite_upgrade.py` contains seven frozen immutable child SHA256 values in `HASHES`.
- All seven checked-out sources now reproduce their frozen SHA256 values **7/7** (Root maintenance, refresh, pending read-only reconciler and four pending owner/H48/protected-hold helpers). The current refresh helper already matched; five missing files were added and the readonly reconciler changed to the frozen byte stream.
- Two additional transitive read-only helper files were restored from Git history `e6afd90883544bbe9d3a6bf9e13614fa9737c65a`. Their independent SHA256 digests are `f2f821a53dd3f91f9ad92b6fad5196073464777887013a5070de30c7b3c76d02` (Aster readonly evidence transport) and `0b0bf4956b4ab147dbaf43b126dfba629f5e10e24a8f85b1348d44d74b633bb9` (pending owned venue validator).
- The tracked `lib/resident-stop-observation.ts` **was not replaced with its older Git version**. The existing five-argument observer body and runtime behavior remain on their original path. Additional source-scoped read-only proof extraction functions are exposed for the separate, explicitly scoped pending maintenance path. The eight-argument pending observer rejects missing or malformed owner pins, and requires the root-attested eight-entry pin projection. Hardcoded historical SHA fallback and environment-based owner-pinning are not imported into that path.
- Before modification, the owner-PC copy of the existing resident STOP file was backed up locally at `C:\tmp\stable4-resident-stop-precompat-20261117.ts` (SHA256 `0707d6c322a16da76cf161d7a141f4fbc9621a02672752bd4a40b3a7d95e2bc6`).
- Added `scripts/ops/test_stable4_pending_frozen_source_closure.py` (3 source-only checks, including exact 7 frozen Root hashes and 2 historical helpers) to the Ubuntu STABLE4 workflow.

## Offline evidence and regression tests

- Repository `npm run typecheck`: PASS.
- STABLE4 all TypeScript contracts: **208 PASS / 0 failed** (includes the six newly added pending STOP owner tests).
- Pending H48/protected hold tests: **11 PASS / 0 failed**.
- Resident STOP and V4/PENGU/Q102 protected-fill regressions: **43 PASS / 0 failed**.
- Explicit pending source-scoped STOP owner + existing observer: **19 PASS / 0 failed**.
- Pending Root Python contract tests: **8 PASS / 0 failed**.
- Immutable child and historical source SHA tests: **3 PASS / 0 failed**.
- Every test was run locally without order/venue writes, keys or VPS changes. GitHub Actions for the new commit must pass separately.

## Still blocked for formal STABLE4 cutover

1. Root release and dispatcher integration still require *external* `disdex_unified_root_gate` and `disdex_pending_maintenance_install` modules with independent source attestations and dynamic-loader proofs. Seven exact child hashes and typecheck success are **not** enough to certify the Root graph.
2. The frozen pending maintenance Root upgrade references its historic `NEW` release `bc46704cba6c5d7cc16ffaa3af32a4d222425505`. The current STABLE4 candidate branch has a **different** SHA; do not silently reuse the frozen historical owner approval, Root upgrade release or receipts for the newer candidate.
3. Q102 old/new writer exclusion, public funding/M5 outcome completion (52 pending), Native Root parser/bootstrap transaction rollback, signed venue/STOP proof, exact source/economic parity, and DD <= 20% remain mandatory gating items.
4. Research integrated BT maxDD 10bps **21.571152%**, 30bps **22.281591%**, exceeding the explicitly required DD threshold. Passing source tests cannot override that risk gate.

No systemd, VPS, owner approval, LIVE runner, venue order, position, protective STOP, Shared Risk or Kill Switch was changed.

**Status: SOURCE_COMPONENTS_RECONCILED_NONPRODUCTION; ROOT_CUTOVER_NOT_CERTIFIED; LIVE_BLOCKED.**
