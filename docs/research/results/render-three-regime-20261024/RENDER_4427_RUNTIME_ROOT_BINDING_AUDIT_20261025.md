# RENDER #4427 — hard-coded research execution-root identity audit (2026-10-25)

**RESEARCH ONLY. Static code-path audit and fail-closed guard. No Native8 economic replay or order authorization.**

## New audited finding

The independent #4427 research entry runner, `scripts/dd-reduction/run-render-4427-independent-profit-sell55-native8-20261024.py`, resolves `REPO=ROOT/'render-multiregime-study-20261024'` with `ROOT=Path('C:/tmp')`. Its `base=load(...,DD/'run-render-4427-native8-shared-wallet-20261024.py')` therefore loads the **older C:/tmp checkout**, not the clean isolated research worktree used for the preceding audit.

- Hard-coded execution checkout: `C:/tmp/render-multiregime-study-20261024`, Git HEAD `173659aef0e28826c4f1c2a2db47a5957eaa5085`.
- Audited clean isolated checkout (before this new commit): `C:/tmp/render4427-runtime-path-binding-20261025`, Git HEAD `b1adbc018c31096c943adaff040968fc4d8a7dca`.
- The two Git commits **differ**. This is a root-identity mismatch, **not** proof of malicious code, execution nondeterminism, or changed backtest results.
- A conservative AST literal-reference graph contains 47 Python source files and 69 edges. All 47 source files in the isolated checkout were checked against the isolated commit's Git object bytes, and all 47 matched the older hard-coded checkout byte-for-byte after normalizing only CRLF line endings. There is **no observed drift in this checked set at audit time**. The graph is an overapproximation, not a complete runtime import/patch closure.
- The brain module is separately loaded from `C:/tmp/render-mtf-study-20261024`; it remains outside the pinned Git tree. Its SHA and the shadow-bank SHA match the previously inventoried bytes but are not independent pre-pinned trust roots.

**Consequence:** even a new isolated-branch patch to one of those 47 modules would not automatically govern an unchanged invocation of the historical entry runner. A clean worktree SHA cannot by itself attest the actual code loaded from the runner's absolute paths. The verified byte parity today does not guarantee parity in a future run.

## Research-only corrective guard

Added a static path resolver and `require_isolated_root(actual, pinned)` guard. It fails closed with `REJECT_EXECUTION_ROOT_NOT_PINNED` when the entry runner's hard-coded root differs from the intended isolated checkout. It also rejects nonliteral or altered base/brain load paths. The guard is **not wired into Native8 or the original runner**; it is a standalone research-side audit and does not grant order permission.

Two fully independent Python processes each passed 15 unit tests and 15 audit assertions. The two audit JSON files were byte-identical with SHA256:

`50576db729b664c8e82edac36e154f11cc7ad4aa95c54b1c7e3b767aba0ad6c6`

## Next trust boundary

Before any Native8 Owner/Route registration or new economic BT, require the runner's resolved execution root to equal an externally pinned checkout; pin the entire effective import/patch closure, the external brain and data bytes, and authoritative Native8 inventory/as-of/13 GateProof provenance independently of the candidate. Preserve same-symbol rejection (including 5/27), 12h cooldown, Shared Risk, Gross, Margin Guard, Kill Switch, Pending, account lock and dedup. June 23/25 modeled entries remain rejected absent genuine proof. Future exit fields must not affect entry priority.

2025 Aster RENDER H1 marks and actual Aster M5 fills/Funding remain uncertified; previously explored 2025H2 is not untouched OOS. No new Forward Shadow primary evidence is claimed. No changes to VPS, LIVE, Production, HP, orders, incumbent eight strategies, legacy `_overlay_block`, or dirty worktrees.
