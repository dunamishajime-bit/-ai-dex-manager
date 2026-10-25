# RENDER #4427 — dynamic PENGU source-patch assert-elision audit

Date: 2026-10-25. Scope: **research-only static code and synthetic execution audit**. No Native8 or PENGU runner imported/executed.

## New verified finding

The upstream wrapper `scripts/dd-reduction/research-pengu-combined-normal8-recovery24-full8-20261024.py` uses `inspect.getsource(function)`, then `src.replace(old,new)`, then `exec(compile(...))` to patch the research main function. Its source-drift guard is:

```python
assert src.count(old)==1,('UNEXPECTED_BACKTEST_ENGINE_SOURCE',src.count(old))
```

This **additional** assertion was outside the previous three-runner/26-assert audit. The exact GitHub blob is `1917333c76d8cbe79783d4e32a6951b6419ef3c1` and its observed raw SHA256 is `b783432853c48df5cb744308adaf3d4468ebefc38577ca4ad660d7f383b90384`. These are posthoc source identities, **not independent trust roots**.

Compiling this exact source under Python `optimize=0` retains one assertion opcode; `optimize=1` and `optimize=2` remove it. Synthetic zero-match source drift is rejected in normal Python but silently leaves the patch unchanged under optimization. Synthetic two-match drift is rejected in normal Python but rewrites both occurrences under optimization. A synthetic explicit `if src.count(old)!=1: raise RuntimeError(...)` guard rejects both drifts in all three optimization modes. **Neither actual source drift nor optimized Native8/LIVE execution has been established.**

## Verification

An isolated analysis environment reconstructed the exact GitHub blob, confirmed the raw SHA256, and passed **15/15 unit tests in each of two independent Python processes**. Two independent static/synthetic audit runs produced identical canonical JSON SHA256: `417175eb2868759fd90716dd593a7e2b593e87e3967dada2c2b4206b3773e550`. A compact, reproducible static audit is included in `scripts/dd-reduction/audit_render_4427_dynamic_patch_assert_elision_20261025.py`. The exact committed audit script was also reproduced in an isolated Python environment (Git blob `a378933ca3244e8348c6b2e8c182f7eb3dec86b9`), producing the committed JSON with SHA256 `55d06704c2e184338e3850a2bcba61d95ced75c27a58c91b3440f5ed94c8e084`.

The owner PC's `C:/tmp` could **not** be accessed in this run: the connected command interface returned `PATH_OUTSIDE_USER_ROOT` and the separate desktop connector reported offline. No owner-PC worktree or remote-PC test is claimed. The GitHub branch is an isolated research branch only.

## Boundaries and next steps

**Status: BLOCKED_OPTIMIZED_DYNAMIC_PATCH_GUARD_ELISION_RESEARCH_ONLY.** No economic BT, Native8 admission, Owner/Route registration, 13 GateProof authentication, venue execution evidence, or actual orders. VPS/LIVE/Production/HP/current eight strategies/legacy `_overlay_block` were not modified.

Replace assert-based patch integrity checks with explicit runtime exceptions in a future isolated research adapter, then authenticate the full dynamic import/patch closure and authoritative as-of inventory/proof root before any Native8 replay. Maintain same-symbol, 12h cooldown, Shared Risk, Gross, Margin Guard, Kill Switch, Pending, account lock and dedup Fail Closed. Keep 5/27 rejected; reject 6/23 and 6/25 without true Native8 evidence. Previously explored periods are **not OOS**.
