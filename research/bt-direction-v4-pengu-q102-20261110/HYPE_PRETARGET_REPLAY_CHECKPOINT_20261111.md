# HYPE pre-target replay checkpoint — 2026-11-11

## Verified

- Remote Desktop Commander connected to DESKTOP-JUK6Q1I.
- Branch synchronized with origin at 8f6e9944b31e8e0c9ed2afc19301e903e58b63ce.
- TAO ATR17 and CAUSAL_FOUR target-year results recovered. TAO gate rejected: no DD improvement and slightly worse win rate, PF, final equity versus CAUSAL_THREE.
- PENGU SHORT_V20 causal pre-target search had zero robust rules. No new V20 gate.
- HYPE pre-target replay completed with isolated copies of pinned source, changing only Node 24 extension resolution in the copied import. Original pinned files were not modified.

## HYPE pre-target proxy result

- Pre-target Binance UM HYPEUSDT/BTCUSDT H1 and HYPEUSDT 5m, May–September 2025.
- Exact pinned signal candidate generation, independently validated M5 exit model.
- Candidate count: 39; unresolved: 0.
- Monthly: June 12, July 7, August 11, September 9.
- Exits: take profit 11, hard stop 28.
- Candidate output SHA256: `4c2ca7e3563749a593e28186d0f7191b436d169299d2fe1a74fea0732216bcf8`.
- Inputs HYPE H1 SHA256: `a2f0b2975aaa9dbee70c0b6896010843756bcf114aa70637692678bc8875d867`.
- Inputs BTC H1 SHA256: `205864cc738bb57eeb89d86bb30e1ab2f749f8c12c49d2be2b4190f9f5166488`.
- Inputs HYPE M5 SHA256: `8fc73d31bf12dffca4cb84006cdb941c892137e4f5`.

## Important limitation

Binance UM is a pre-target proxy, not Aster venue parity. No HYPE gate is adopted. The 39 candidates need chronological training/validation/prehold and true Aster forward falsification. Do not use target-year performance to select thresholds.

## Next

1. Reuse `hype-preperiod-proxy-candidates-with-m5-exits.jsonl` in `C:\tmp\disdex-bt-20251001-20261001\PREPERIOD_TRAIN_20250501_20251001\HYPE_BINANCE_PROXY`.
2. Construct train-only thresholds and evaluate validation, prehold, true-forward separately; test sample-size sensitivity and stop/TP skew.
3. Freeze any surviving HYPE gate before full target-year integrated A/B.
4. Run 10bps and 30bps with twice-run SHA256 checks. Keep CAUSAL_THREE as reference.
5. No Production changes or orders.
