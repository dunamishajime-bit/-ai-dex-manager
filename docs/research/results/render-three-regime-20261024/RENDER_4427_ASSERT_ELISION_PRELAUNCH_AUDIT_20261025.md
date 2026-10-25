# RENDER #4427 — Optimized-Python assert-elision and prelaunch boundary audit

Date: 2026-10-25. Scope: **research-only static code compilation**, not Native8 execution or a new economic backtest.

## New independently reproduced finding

Three upstream #4427 research scripts contain **26 Python `assert` checks**. Compiling their exact source with Python `optimize=1` or `optimize=2` eliminates **all 26 assertion bytecode operations**. In normal `optimize=0`, all 26 remain. Independent synthetic invariant test: invalid count is rejected at optimize=0 and accepted at optimize=1/2. A separate interpreter probe confirms both `python -O` and `PYTHONOPTIMIZE=1` enable optimization on the owner PC.

- Independent entry runner: **9** assertions, including exact 3-candidate parity, unique timestamps, required family/exit, duplicate candidate key exclusion, exit-time bounds, finite prices, and C:/tmp output restriction.
- Base #4427 runner: **9** assertions, including strategy configuration parity, modeled price/exit bounds, and output restriction.
- Triple-entry upstream runner: **8** assertions, including bank cardinality, input bounds, and output restriction.

**This is a reproducible research-runner invariant bypass under optimized Python, not evidence that Native8/LIVE used optimized Python, made duplicate orders, or bypassed native risk controls.** The explicit `raise RuntimeError` H1-mark continuity checks remain active under optimization.

## Research-only mitigation

A **non-executing prelaunch policy** rejects `-O/-OO`, nonempty `PYTHONOPTIMIZE`, an already optimized guard interpreter, unpinned `PYTHONPATH/PYTHONHOME`, unknown interpreter options, and missing independently trusted root. The clean synthetic launch returns `RESEARCH_PRELAUNCH_INTERPRETER_ONLY_NOT_AUTHORIZED`; this is not a native allocation or order permission. No existing runner was modified, and this guard has not been wired to Native8.

## Reproducibility and limitations

- Two independent Python test processes: **17/17 PASS each**.
- Two independent audit processes: canonical JSON SHA256 **`c61e8c684464df8d4cc3faf7f4cd6dc36f523999e3b4b57ab1b9145f4954c14f`** in both.
- Full source bytes observed and digested in accompanying JSON. Observed SHA is **not** an independently pinned trust root.
- Import-time effects, dynamic source patching, external brain, hardcoded old runtime path, Native8 Owner/Route and 13 GateProof remain **untrusted / unregistered**.
- 5/27 same-symbol conflict must remain rejected; 6/23 and 6/25 modeled entries remain rejected without native as-of proof.
- Aster 2025 RENDER H1 marks are missing; real Aster M5 fills and funding unverified. Previously explored data are **not OOS**.
- No economic replay, no change to current 8 strategies, `_overlay_block`, VPS, LIVE, Production, HP, or real orders.

Status: **BLOCKED_OPTIMIZED_PYTHON_ELIDES_RESEARCH_INVARIANTS**. Fail closed for optimized or unauthenticated execution; continue owner/route and native evidence provenance research in a new isolated worktree.
