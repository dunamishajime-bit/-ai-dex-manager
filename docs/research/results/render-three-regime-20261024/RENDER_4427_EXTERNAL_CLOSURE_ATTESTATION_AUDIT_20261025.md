# RENDER #4427 — external research dependency and import-closure audit (2026-10-25)

**RESEARCH ONLY — READ-ONLY STATIC AUDIT. NO NATIVE8 ORDER AUTHORIZATION OR ECONOMIC BT.**

## New finding

The earlier ten-file Native8 import-chain audit was a **linear spine, not the full dependency closure**. The independent #4427 research runner has two **top-level** `load(...)` calls. One loads the checked-in shared-wallet runner, while the other loads the research decision module **outside the Git checkout**:

`C:/tmp/render-mtf-study-20261024/render_4427_independent_rolling_profit_gate_20261024.py`

That 9,469-byte Python module directly constructs the independent SHORT gate's as-of rolling profit/WR/PF decisions. Its observed SHA256 is:

`2ffb72b8707a3f32e68270b7e89c2ee01d2c2484922057f0037cefdc17c2d230`

It was **not found in the pinned Git commit's tree**. This is not proof that the file was modified or malicious; it is a **missing independent provenance binding**. A Git commit and the previously reconstructed transformed `main` source cannot by themselves attest the effective independent-gate runtime.

The module also loads a compressed shadow-entry bank from `C:/tmp/render-mtf-study-20261024`. Unlike the module, this 587,939-byte bank **does** have an exact byte-identical copy in the pinned Git tree:

`docs/research/results/render-three-regime-20261024/RENDER_4427_INDEPENDENT_ALL_GATE_SHADOW_ENTRY_BANK_20261024.json.gz`

Its SHA256 is `d5234a91155afa2e232b0c2372b4a929a875ee79ef23d085a6417ecfab334c07`.

## Scope and reproducibility

- Pinned research commit: `0391c680a15e946ea0a56195670bbd91697ef830`.
- All **10 spine sources** were compared to immutable Git object bytes, permitting only verified CRLF checkout conversion.
- A conservative AST scan of literal local `.py` references reachable from the runner identified **47 files and 69 links**. **This is an overapproximation, not proof that all 47 modules execute**; optional and unused references can be included. Dynamic imports not represented by literal paths may still be missing.
- The known PENGU research `main` transformation was independently reconstructed and matched the prior transformed SHA256 `6eb3008a7f40bd1577d22f8daf8baa94f2a8ae0b87f1f58f81c6cf739860677b`.
- Two separate Python processes each passed **10/10 static assertions**, yielding byte-identical audit JSON, SHA256 `5dcfc83eb9608f62e2aa9a03f415ecdb2e3e365b192cf1884ec736e14c763c68`.

## Decision

**BLOCKED_UNTRACKED_BRAIN_SOURCE_RESEARCH_ONLY**. This is a provenance audit, not evidence of runtime nondeterminism, a backtest profit change, or an actual safety bypass.

The observed brain SHA is an **after-the-fact research inventory hash**, not an independently pre-pinned trusted root. To move forward, bind the exact brain source and all import/patch closure inputs to an independently pinned manifest, then verify immutable entry projection, authoritative inventory/as-of state, 13 safety proofs and Owner/Route priority in Native8 itself. Do not mistake a locally generated hash for native attestation.

May 27 same-symbol conflict remains rejected. June 23/25 remain Fail Closed until genuine as-of Native8 proof is available. 2025 Aster RENDER H1 mark coverage, actual Aster M5 fills and Funding are not certified. Explored 2025H2 is not untouched OOS. No new Forward Shadow primary evidence is claimed.

No VPS/LIVE/Production/HP/orders, incumbent strategies, legacy `_overlay_block`, or dirty worktrees were changed. No economic BT was run.
