# RENDER #4427 独立SHORT — Native8 共通資金・優先権の研究
Date: 2026-10-24 (JST). Status: **RESEARCH_ONLY — NOT APPROVED FOR LIVE**.

## Scope
- Exact independent route: `IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT`; SHORT only; no mandatory OI source.
- Retrospective as-of regime gate and closed-shadow win/PF ranking; incumbent #4427 remains in the candidate universe.
- A single scoped in-memory source patch, immediately after the **unchanged original** CORE-over-IDLE admission-prep and just before native application, considers only this route for coexistence with other symbols' CORE positions.
- **Preserved:** incumbent IDLE preference when same-symbol candidates coexist, RENDER same-symbol ownership, filled-symbol cooldown, data/auth route flags, native quantity, strategy/gross/portfolio risk caps and native portfolio accounting. A conservative research 3.0 crypto/4.25 total gross pre-check also remains. No LIVE, VPS, order, HP or Production modification.
- Frozen eight-strategy H1 modeled research replay: 2025-08-10 to 2026-08-10. Triple replay for each cost 10/30bps.

## Full8 economic outcome

| Metric | 10bps baseline | 10bps scoped | 30bps baseline | 30bps scoped |
|---|---:|---:|---:|---:|
| Final equity JPY | 288,587,378.77 | 290,070,131.97 | 174,459,200.22 | 175,324,355.25 |
| Improvement JPY | — | **+1,482,753.20** | — | **+865,155.03** |
| Closed trades | 1291 | 1293 | 1290 | 1292 |
| Profit factor | 4.740434 | 4.756888 | 3.825951 | 3.835145 |
| Max mark-to-market DD (%) | -14.514985 | -14.514985 | -15.014724 | -15.014724 |

Both costs: +2 accepted independent SHORT trades, 0 displaced baseline closed trades, 0 same-symbol RENDER overlap, all native accounting PASS, no increase in max MTM DD.

## Admission and realized study outcomes
- 2026-05-27 21:00 UTC: rejected because existing same-symbol RENDER incumbent position was open (Q102 FET long simultaneously).
- 2026-06-23 01:00 UTC: accepted alongside a different-symbol Q102 FET short; research 10bps trade accepted gross approx 0.22275x.
- 2026-06-25 07:00 UTC: accepted alongside V12 DOGE/ADA/NEAR shorts and PENGU short; research 10bps accepted gross approx 0.21256x.
- 10bps modeled JPY PnL for the two added trades was approximately +719,557 and +711,043 JPY, separately. Their effects on later portfolio equity allocation explain that final-equity delta need not equal that sum.
- Independent exit model in this test: `RESEARCH_INDEP_S6_TP1P5_STOP2_H6`.

## Deterministic verification
- **PASS:** 3/3 economic metric equality at 10bps and 3/3 at 30bps.
- **PASS:** all modeled closed-trade rows, including exits, quantity, PnL, normalized to exclude the synthetic `candidate_id`, hash-identical across triple replays. See JSON audit hashes.
- **LIMITATION:** raw ledger and candidate-decision byte SHA-256 differ because synthetic candidate IDs are assigned differently in the repeated injections; do **not** claim bitwise full-ledger parity.
- **PASS:** no original closed trade disappeared and no overlapping accepted RENDER ownership was introduced.
- Source research driver script SHA256: `c1afa4eba204f3f0e425a3e578897cf3b96fab2433c2fe30912143068632ddc9`.

## Adoption gates outstanding
These two extra winning trades are insufficient to establish robust conditional expected value. The gate and SELL55 selection used historical outcomes, so an untouched chronological walk-forward/OOS evaluation is still required. Prior 2024 and Aug-Oct 2026 isolated-gate screens are *not* proof of 8-strategy production parity. Before adoption, require more independent **accepted** trades across adverse regimes, 10/30bps economic + DD robustness, causal score/priority replay, stable candidate identifiers, venue/pending/margin parity, and operator approval for any change to CORE-over-IDLE priority.

Current decision: **preserve LIVE/Production as-is; research candidate only**.
