# RENDER #4427 — Gross source patch and optimized Python assertions (research-only)

Audit date: 2026-10-25 (JST). Status: **RESEARCH_ONLY_GROSS_PATCH_FAIL_OPEN_UNDER_OPTIMIZE**. This is a new, narrow audit of a fourth-root gross-sizing patch, not a claim about actual Native8 or LIVE runtime.

## Primary sources and independent reproducibility

Read-only source files under `C:/Users/dis/Desktop/disdex-exit-overlay-handoff-20261017/research/exit_overlays_20261017/scripts/`:

- `idle_gross_fractional_isolated_full8_20261016.py`: SHA256 `9f2d713bc7d0efed73923e3839e43c39fcdc318baec9c58f9c3244e42c53ab8c`.
- `bt120_idle_gross_q102hype_20261017.py`: SHA256 `61b2f1e7167231e68ba9cb764cb2695511cfc246d0c99c9a9c86aa514839501d`.

The exact source bytes were independently checked in two fresh Python processes on the owner PC. Each process exited 0 and emitted the same canonical audit JSON SHA256: `7d789257ae297a20c8dded811e1d36db66a65d31fa89afa9e52dff2a1234a434`. The committed JSON is the canonical evidence payload. Only source AST and the isolated `researched_source_patch` function (with an identity `originalPatch` stub) were evaluated; no research target module was imported or executed.

## New verified findings

1. **Two exact-Gross source replacement guards disappear under optimization.** In `idle_gross_fractional_isolated_full8_20261016.py`, lines 18 and 22 require exactly one occurrence of the original `requested = 1.0` and `elif room + 1e-9 < 1.0:` snippets. Both are `assert`, followed by `replace(..., 1)`. The original module has 3 assertion bytecodes with optimize=0, and zero with optimize=1 or 2. The related helper has 4 with optimize=0 and zero with optimize=1 or 2 (lines 31, 63, 73, 87).
2. **Synthetic source drift proves the failure mode.** With optimize=0, each of four malformed synthetic sources (missing or duplicate occurrence of either snippet) is rejected by the isolated extracted function. With optimize=1 or 2, all four are accepted. If a snippet is missing, that rewrite is silently absent; if duplicated, only the first occurrence is rewritten, leaving one old occurrence. The valid source succeeds in all modes.
3. **Research output checks are also optimization-sensitive.** The helper's `assert len(ledgers)==1` and `assert max_gross<=expected+1e-6` disappear under optimization. This creates a potential research-result validation gap if optimized execution were used; this audit does not establish that it was used or that any actual ledger was wrong.
4. **Import-time quantity hook nuance.** Importing the gross helper changes the `quantity_ok` function pointer, but its `_allowed_fractional_symbols` set starts empty; the function delegates to the original for symbols outside that set. The helper populates the set when `run(policy,cost)` starts (lines 64–65). Thus import-time monkey patching alone does **not** prove that fractional quantities were admitted. This distinction matters when assessing effective economic impact.

## Required research-only correction (not applied to original)

A new isolated adapter should require exact snippet counts using unconditional `if count != 1: raise RuntimeError(...)`, use preimport externally pinned bytes for every dynamic patch source, and assert that the resulting transformed-source SHA matches a separately trusted pin. Any missing independent root, mismatched execution path, untracked legacy source, or unresolved import-time global mutation must remain Fail Closed. No synthetic/posthoc pin can be promoted to authoritative evidence.

## Scope and limitations

This is a reproducible *isolated source-function* proof, not a full Native8 runtime trace, not an economic backtest, and not evidence of LIVE use of `-O`, oversizing, double orders, or bypass of Shared Risk, Gross, Margin Guard, Kill Switch, Pending, same-symbol, cooldown, account lock, or dedup. Formal Owner/Route and 13 GateProof remain unauthenticated. No VPS/LIVE/Production/HP/orders/current-eight-logic or original worktree changes. No new owner-PC C:/tmp worktree was created because that path is outside the current permitted write scope.

Reproduction: `python scripts/dd-reduction/audit_render4427_gross_patch_optimization_20261025.py` on an authorized PC with the exact source paths above; output JSON must hash to the recorded canonical SHA256. The study must remain research-only.
