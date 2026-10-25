# RENDER #4427 — fourth-root dynamic patch closure audit (2026-10-25)

**STATUS: BLOCKED_TRANSITIVE_DYNAMIC_PATCH_ROOT_NOT_INDEPENDENTLY_ATTESTED**

## New source-backed result

The previously identified untracked `task8_v12_long_noncanonical_20261020.py` imports `long_two_axis_latest_full8_20261019.py` from a third Windows research checkout. Read-only AST tracing on the owner PC shows that the third-root adapter's `bootstrap()` adds a **fourth** source root:

`C:/Users/dis/Desktop/disdex-exit-overlay-handoff-20261017/research/exit_overlays_20261017/scripts`

It reads `bt120_integrated_5minute_full8_20261017.py`, performs **two source-string replacements** (the frozen archive ROOT and output OUT), and then runs `exec(compile(modified, path, "exec"), obj.__dict__)` at line 37. It subsequently imports `bt120_idle_gross_q102hype_20261017` from the fourth root. This is a separate runtime code transformation from the previously audited PENGU `native.main` patch. Thus the Git SHA, 47-file literal graph, and PENGU transformed-main SHA do **not** attest the entire effective Native8 research code.

On the owner PC, the fourth root was at Git HEAD `6c9b9d032a18c44c82fcfd2f5a74226d71d68160`; targeted Git status for the target and helper was clean. Observed actual-byte SHA256:

- Third-root adapter: `f861140de0a123aef0e4ce93f21e6b0b83ec9f9594921c4bca0439fc65f56108`.
- Fourth-root integrated target: `6fd448cc4dae0feb336c349ca1debdc7d74e22499650bdc65739cbf6ab12ca53`.
- Fourth-root helper: `61b2f1e7167231e68ba9cb764cb2695511cfc246d0c99c9a9c86aa514839501d`.
- Statically reconstructed **transformed** target source: `56dc1efc8add5f8c82767089b4410daa8e98f33de5fc98ebad3d8d2654a57f92`.

Each replacement matched exactly one occurrence; the transformed source compiled under Python optimize 0, 1, and 2. **The target was never executed or imported during the audit.** These are observed hashes, not candidate-independent authenticated pins.

## Additional optimization boundary

The third-root adapter guards the two string replacements using `assert original.count(find)==1` and `assert modified.count(findout)==1` (lines 28 and 31). Independent bytecode compilation of the **actual adapter source** yielded two `LOAD_ASSERTION_ERROR` instructions at optimize 0 and zero at optimize 1/2. This is a separate pair of elidable guards outside the previously audited three RENDER runners and the PENGU patch wrapper. No evidence shows the actual research process used optimization or experienced source drift.

## Reproducibility

The committed read-only script `scripts/dd-reduction/audit_render4427_fourth_root_patch_closure_20261025.py` checks source bytes, the fourth-root Git HEAD and targeted status, AST patch locations, exact replacement counts, transformed source SHA, compilation, and optimize-dependent bytecode. It contains **explicit exceptions rather than asserts** for its own safety checks and never imports/executes target research modules.

Two separate owner-PC Python processes ran this exact committed script successfully and emitted identical canonical audit JSON SHA256:

`15072cf85586b888ea8839c95803dba03665cc8f517e80e2298b160befef6be9`

Evidence: `RENDER_4427_FOURTH_ROOT_DYNAMIC_PATCH_AUDIT_20261025.json`.

## Trust boundary and next action

The fourth-root target/helper, the two untracked task8 modules, and the transitive dynamic source patches must be bound to a **candidate-independent preimport pin manifest**, including the transformed bytes. The adapter's two assert guards should be replaced by explicit `if ...: raise` **only in a future isolated research adapter**; do not modify the legacy source or existing eight strategies. The fourth-root helper's further dependencies and the actual Native8 inventory/13 GateProof authorities remain unauthenticated.

No formal Owner/Route registration, no genuine 13-GateProof producer root, no economic Native8 10/30bps replay, no Forward Shadow admission, and no LIVE approval. May 27 stays rejected for same-symbol conflict; June 23/25 stay rejected absent authentic evidence. No VPS/LIVE/Production/HP/order/IDLE Core changes. The owner-PC audit only read existing user-root files; no C:/tmp worktree was created because that location is outside the connected interface's permitted scope.
