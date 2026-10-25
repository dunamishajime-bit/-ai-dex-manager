# RENDER #4427 — transitive legacy bootstrap root audit (2026-10-25)

**Status: BLOCKED_UNTRACKED_TRANSITIVE_BOOTSTRAP_AND_INDEPENDENT_TRUST_ROOT**

## New, source-backed finding

The research Native8 upstream is not closed by the previously audited 47 literal-linked Python files, the external RENDER brain, or the dynamic PENGU patch. The source-backed path from the Q102 cumulative research wrapper imports `task9_initial_adverse_stop_20261020.py` (line 13 of the caller). That module **at import time** inserts a separate `.codex/worktrees/dd-reduction-sequential-20261019` path into `sys.path` (line 87) and imports `task8_v12_long_noncanonical_20261020` (line 88), while temporarily replacing `Path.write_text` (lines 85, 90). Its later bootstrap calls use `task8.legacy.bootstrap()` and `ensure_baseline()` (lines 1080–1082). This is a static source-path observation; the full runtime closure has **not** been executed or authenticated.

Two independent, read-only Python processes on the authorized owner PC inspected exact Git blob bytes and the named legacy files. Both passed the same structural assertion and produced identical canonical JSON SHA256:

`2e82b88c72b4f6c9ad743244e1afeac744be62a9a7e4a2c9dad1ff0b92a2daa4`

Git source blobs: `task9_initial_adverse_stop_20261020.py` = `3a5e60577caab87a8eebb0aff22dbd6be7207255`; Q102 wrapper = `bbfa393348869a0227897bf0c4785df501cc1229`.

## Owner-PC read-only evidence

The two files `task8_v12_long_noncanonical_20261020.py` and `task8_v12_long_compound_20261020.py` **exist but are untracked** (`??`) in the external `.codex` worktree at Git HEAD `05756e588766a6eb7f1863a1dad64b984233601d`. Their observed byte SHA256 values are respectively:

- `834747c00ea20c87a86d8f53028d3b451d4e8642b3bd83d0f9d034ca6144bbc0`
- `445e915a9b494158ddb501e7c8aaf7248bc87d2c5a72cbc79ee1e2fe8b0d88d7`

The first task8 module also inserts a further root `C:/Users/dis/Desktop/disdex-idle-basket-bt-20261019/research` into `sys.path` and imports `long_two_axis_latest_full8_20261019`. That second root was present at Git HEAD `44c840dba6224c4f51ad618c03ada047de642224`; its two inspected files had clean targeted `git status`, with observed SHA256 values `f861140de0a123aef0e4ce93f21e6b0b83ec9f9594921c4bca0439fc65f56108` and `fa2eb742a6ec9cdec9c8e0ade8a3dd9b1bf417e15472ca498390242b42a1f350`. A clean local checkout **does not** constitute an independently pinned trust root.

## Contract and limitations

The 47-file literal-reference graph was never claimed to be a complete runtime closure. This audit establishes an additional *transitive, dynamically resolved* source dependency, not a new economic return, order bypass, or evidence that future exit values influenced admission. The observed local hashes are post-hoc measurements, **not independently attested source identities**. A GitHub commit and self-reported `source_runtime_sha` remain insufficient.

The added read-only script `scripts/dd-reduction/audit_render4427_external_legacy_bootstrap_boundary_20261025.py` inspects Git object bytes using AST, without importing or executing research modules. It explicitly fails closed on missing independently authenticated legacy sources. A separate in-memory execution of the script's audit function on owner-PC Git blobs confirmed the static chain and expected Git blob IDs.

**No new economic BT; no formal Owner/Route registration; no 13 GateProof authentication; no LIVE adoption.** No changes to the dirty worktree, legacy modules, old IDLE Core, existing eight strategies, VPS, Production, HP, or real orders. C:/tmp research worktree could not be created through the available scoped PC interface; only the isolated GitHub research branch was changed.

Next: establish a candidate-independent source authority for the two untracked task8 modules and their transitive legacy import, capture the full preimport/patch closure, then separately trace Native8 inventory, sequence, receipt, and the 13 proof-producing authorities. All missing evidence remains Fail Closed. The May 27 same-symbol rejection is unchanged; June 23 and June 25 are not admitted on modeled evidence.
