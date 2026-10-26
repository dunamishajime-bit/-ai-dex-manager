# RENDER #4427 — Protected Venue Readback: Same-Symbol Multi-Position Audit (2026-10-27)

## Status
**RESEARCH_ONLY / NEW_FINDING / NEED_NATIVE_ALLOCATOR / order_authorized=false**

Owner: `IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH`  
Route: `IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT`  
Gross: `0.25x` (research contract; this audit does not place or size an order).

## Primary-code source identity
Immutable source commit: `939b59da49ce7960485a2004b0068dc63417ae82`.

GitHub raw bytes were downloaded directly on the authorized owner PC and SHA256-pinned before running the original TypeScript with Node `stripTypeScriptTypes` + `vm`:
- `scripts/disdex-idle-priority-short-protected-rate-budget-recovery.ts`: `70f319371e39e22d0df3b355b079c8336e5d205f022fe6ee752e218f60a4fc09`
- `lib/idle-priority-short-state.ts`: `4f09cb0c7f430ffde65c993b7ac57af8284605eefa89df2d11973bb77ec09f07`
- `config/idlePriorityShortPolicy.ts`: `6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8`

## New finding (distinct from prior state-writer/lock races)
`assertProtectedVenueReadback()` uses `positions.find(...symbol... && abs(quantity)>0)` and validates **only the first matching position**. It does not require the position list for that symbol to contain exactly one matching position, nor does it reject a second same-symbol LONG or SHORT exposure. In a controlled synthetic venue readback containing the expected RENDERUSDT SHORT with matching STOP_MARKET/TAKE_PROFIT_MARKET orders **plus another RENDERUSDT LONG (or SHORT)**, the unmodified `recoverIdleProtectedRateBudgetState()` returns PASS and clears the stored manual-review state.

The synthetic multi-position cases are relevant to evaluating the trust boundary of hedge-mode position inventory, but are **not** evidence that the actual Aster API currently returns such a list, that the production operator invoked this recovery, or that a live position was affected. The supplied `venue` is a synthetic in-memory adapter, not an authenticated venue receipt.

Positive controls: one matching SHORT with its two valid reduce-only protection orders passes. Negative controls: missing position, mismatched quantity, wrong first matching position, missing STOP, unmanaged active order, pending state, unrecognized review, and wrong stop price are rejected before recovery.

**Security implication:** A single expected-position match is insufficient to prove absence of additional same-symbol exposure. Require complete symbol-side inventory with source identity/freshness, explicit duplicate/hedge-mode handling, and authoritative venue receipt before clearing manual review. Do not treat this synthetic test as certification.

## Reproducibility
Owner PC allowed research root: `C:/Users/dis/render4427-research-only/`. Test cases ran only under fresh subdirectories of this root; `TMP`/`TEMP`/`TMPDIR` were set there.

Original TypeScript functions were evaluated from SHA-pinned source bytes; test adapter and scenario construction were separate. Independent **two Python launchers each in normal, -O, -OO modes**, six exit code 0, twelve scenarios per launcher: **72/72 PASS**. Each launcher emitted the same canonical JSON SHA256:

`31f554f7f1906d98a4a21608b44e67b5f3e9cc82881b691d3fee43d28df1c13d`

Evidence file local SHA256: `2b6679a6d99c6796e94f283f11ac7b2dccef83cdabeb786942f07b799e208d2f`.

Audit script: `scripts/dd-reduction/audit_render4427_protected_venue_multiside_20261027.py`.  
Evidence: `docs/research/results/render-three-regime-20261024/RENDER_4427_PROTECTED_VENUE_MULTISIDE_AUDIT_20261027.json`.

## Boundary / no operational action
No VPS, LIVE, Production, HP, real orders, current eight strategies, old IDLE Core `_overlay_block`, or dirty worktree modifications. No permission to bypass Shared Risk, account lock, pending, gross, margin, cooldown, dedup or Kill Switch. No Native8 economic backtest or real-order authorization was performed. Existing rejected 5/27 and uncertified 6/23, 6/25 modeled entries remain rejected. Forward Shadow OOS has not been established.

Next: trace real operator call site, source/age of venue inventory and whether the Aster adapter can return multiple same-symbol rows; verify full inventory and hedge-mode semantics against independent authenticated evidence before any Native8 replay.
