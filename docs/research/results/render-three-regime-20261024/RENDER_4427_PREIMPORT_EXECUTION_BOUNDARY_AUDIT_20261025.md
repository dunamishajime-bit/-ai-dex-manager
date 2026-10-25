# RENDER #4427 — pre-import execution boundary audit (2026-10-25)

**RESEARCH ONLY — no Native8 runner was imported or executed; no economic BT, orders, LIVE, VPS, Production or HP changes.**

## New audited finding

The historical independent-SHORT entry runner performs material research operations at Python **module import time**, before its `if __name__ == '__main__': main()` guard:

- Two module-scope `load(...)` calls dynamically import the Native8 base and the external rolling-profit brain.
- Module-scope assignments modify research case configuration / Native8 research function bindings.
- Module-scope `result = brain.replay(cfg, events=filtered, save=True)` computes selected trades before `main()` is reached. In the inspected external brain, `save=True` adds trades to the in-memory return dictionary; it is **not** proof of filesystem writes.
- The runner's declared `REPO` remains `C:/tmp/render-multiregime-study-20261024`, regardless of the new isolated worktree.

**Consequence:** placing a trust-root/path check inside `main()` is too late to attest or prevent the module-scope imports and computations. Merely copying the runner into an isolated worktree also does not redirect its declared runtime root.

## Research-only pre-import gate

Added `scripts/dd-reduction/audit_render_4427_preimport_guard_20261025.py`, a pure static preflight that **never imports or executes** the runner. It checks (a) independent pin availability, (b) runner file path, (c) AST-declared execution root, (d) runner/brain/bank bytes and (e) Git HEAD. It refuses to promote post-hoc measured digests to genuine independent trust roots.

On the observed environment:
- Missing independently provided root: `REJECT_NO_INDEPENDENT_TRUST_ROOT`.
- Historical runner path versus isolated checkout: `REJECT_PREIMPORT_EXECUTION_ROOT_NOT_PINNED`.
- Copied runner at isolated path but still declaring old root: `REJECT_PREIMPORT_DECLARED_ROOT_NOT_PINNED`.

The `independently_trusted` input is only a **research API placeholder**, not an authenticated signature or authority. The synthetic pin exercise proves branch behavior only, not provenance. No code path in this audit authorizes a native allocator or order.

## Verification

Ten synthetic/static tests PASS in each of two independent Python processes. Two independent audit processes produced byte-identical JSON, SHA256 `42f35dcc9f1041b08ab76350f72d12e864002d7adfa231e97f9b3918055927ba`.

Output: `RENDER_4427_PREIMPORT_EXECUTION_BOUNDARY_AUDIT_20261025.json`.

## Limitations and next steps

This is an AST/source-boundary audit, not full import closure attestation, not authentic Native8 inventory/root/13 GateProof evidence, and not Native8 Owner/Route integration. No new economic BT or OOS result. The known 2025 H2 exploration is not untouched OOS. Aster RENDER H1 marks and actual Aster M5 fills/Funding remain uncertified.

Before any candidate replay, acquire an **independently anchored** execution-root and full dynamic-import/patch closure manifest, then authenticate Native8 producer identity, sequence, as-of inventory, 13 GateProofs and atomic dedup. Preserve same-symbol conflict (5/27), 12h cooldown, Shared Risk, Gross, Margin Guard, Kill Switch, Pending, account lock and dedup. June 23/25 must fail closed without genuine Native8 as-of evidence. Do not use future exit values for entry priority, alter legacy `_overlay_block`, modify dirty worktrees, or change incumbent eight strategies or LIVE systems.
