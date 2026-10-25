# RENDER #4427 — transitive import-time side effects (2026-10-25)

**STATUS: BLOCKED_IMPORT_TIME_SHARED_ENGINE_MUTATION_AND_UNATTESTED_ROOT — RESEARCH ONLY**

## New primary-code finding

The third-root `long_two_axis_latest_full8_20261019.py` calls `bootstrap()`, which imports the fourth-root helper `bt120_idle_gross_q102hype_20261017` at line 38 and only **after the import completes** rebinds `original_helper.OUT` and `original_helper.base.OUTROOT` (lines 39–40).

Static AST tracing of the six actual-byte SHA256-pinned source files establishes that this import recursively loads the fourth-root combined/5m/gross modules. **These modules perform module-scope mutations**, not just definitions:

- `bt120_integrated_5minute_full8_20261017.py`: `OUT.mkdir` (line 13), `base.OUTROOT=OUT` (14), `base.causal_exit=apply_policy` (142).
- `bt120_combined_and_slippage_stress_20261017.py`: `COMBOS.mkdir` (10), registry modifications (34–35), `base.causal_exit=combo_exit` (69), `base.OUTROOT=COMBOS` (70).
- `idle_gross_fractional_isolated_full8_20261016.py`: `base.BASE_ADMISSION_PATCH=researched_source_patch` (25), `base.wrapped_filter=candidate_factory` (41), **`base.s.w.base.quantity_ok=research_fractional_quantity_ok` (63)**.
- `bt120_idle_gross_q102hype_20261017.py`: `OUT.mkdir` (13), `base.OUTROOT=OUT` (14), `base.wrapped_filter=experiment_filter` (60).
- The third-root adapter itself declares `OUT.mkdir` and `COMPARE.mkdir` at module scope (16–17).

The `OUT` in the fourth-root helper derives from the dynamically patched integrated module's `ROOT` (the historical archive), and the helper's module-scope `mkdir` occurs **before** the third-root adapter's later output rebinding. The script was not imported or executed for this audit, so this is a **potential import-time filesystem side effect inferred from source**, not evidence that any directory was newly created during this audit.

The **quantity validation function is monkey-patched at import time**. Therefore an import-closure attestation that only pins the dynamically transformed main function, or checks output path after import, does not prove the identity of the effective research admission/quantity validator. The additional mutable global state must be explicitly attested, and an independent pre-import guard must reject untrusted roots before the first module load.

## Reproducibility

Committed read-only AST script `scripts/dd-reduction/audit_render4427_transitive_import_side_effects_20261025.py` verified six primary source-byte SHA256 values and the exact import/mutation/rebinding locations. Two independent owner-PC Python processes executed the **fetched committed script** with exit code 0 and produced identical canonical JSON SHA256:

`6d4557e1848d682133e3fad25829d875cd19f401d623db577fd06446791bf1a2`

The canonical evidence JSON is stored alongside this report. No target research modules were imported or executed; no backtest was run.

## Trust and operating limits

These six observed source hashes are **not** candidate-independent genuine Native8 roots. There is no evidence that the current LIVE runtime uses this import chain, no genuine 13-GateProof authority, no authenticated inventory/root, no formal Owner/Route registration, and no 10/30bps Native8 economic replay. Do not claim a LIVE safety bypass. Keep 5/27 rejected for same-symbol ownership; keep 6/23 and 6/25 rejected without genuine native evidence.

Next: design a research-only **static pre-import manifest** covering all dynamic patches, import-time mutation targets, output paths, external untracked sources, and entry-time producer evidence. Use explicit `if ...: raise` guards in any new isolated adapter, never modify the original research modules or the existing eight strategies. Preserve cooldown, Shared Risk, Gross, Margin Guard, Kill Switch, pending, account lock, and dedup; never rank entries using future exits.

No VPS/LIVE/Production/HP/orders, old IDLE Core, or existing worktrees were modified. The owner PC's `C:/tmp` remains outside the connected interface's permitted write scope, so no PC worktree was created.
