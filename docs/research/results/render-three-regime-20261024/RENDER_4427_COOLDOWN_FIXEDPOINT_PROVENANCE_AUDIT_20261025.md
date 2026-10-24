# RENDER #4427 — Native8 cooldown fixed-point provenance audit (2026-10-25)

STATUS: RESEARCH ONLY. Previously labeled raw three-replay drift is a comparison of different feedback iterations.

## New causal finding
The source explicitly begins I0 without cooldown events, feeds back accepted STOP events into I1, and iterates until the cooldown event set converges. The V12 preallocation filter removes SHORT candidates within those 12-hour windows.

| Cost | I0 candidates | I1 / I2 candidates | I0-only V12 | Matched prior-pass accepted STOP windows |
|---|---:|---:|---:|---:|
| 10bps | 2,444 | 2,424 / 2,424 | 20 | 20 / 20 |
| 30bps | 2,444 | 2,424 / 2,424 | 20 | 20 / 20 |

All 20 extra candidates are inside accepted first-pass V12 SHORT STOP cooldown windows. They are absent from both feedback passes; all other candidate rows remain exactly identical. The 10bps/30bps witness SHA matches.

## Interpretation
The 3 files are fixed-point iterations with **different inputs**, not three independent identical-input replays. Comparing their raw SHA is not a valid nondeterminism test. Reproducibility requires **fresh separate-process full-run** tests at identical frozen inputs and comparison of the converged final pass, including candidate IDs and raw decisions. No row was deleted or ID normalized to force equality.

## Still blocked
- Archived replay evidence plus source-level control-flow proof; no fresh clean-process full8 repeat.
- The prior claim of raw three-pass nondeterminism is not supported because the passes have different cooldown inputs.
- Formal independent Owner/Route and safety gate parity not certified.
- 2025 Aster RENDER H1 mark missing, Aster signed fills/funding unverified, explored periods not untouched OOS.
- No VPS/LIVE/Production/HP/orders changed.

Evidence: accompanying JSON, pinned source hashes, archived candidate manifests, first-pass accepted STOP event ledger. No LIVE or production changes.
