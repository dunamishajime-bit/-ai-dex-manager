# RENDER #4427 — fresh-process final-iteration Native8 raw audit (2026-10-25)

STATUS: RESEARCH_ONLY_FRESH_PROCESS_RAW_DETERMINISM_PASS

Two independent Python processes A/B each ran the full research Native8 engine for 10/30bps.
I0/I1/I2 within a process are cooldown feedback iterations, NOT independent repeated inputs.
A/B compared identical iteration index at frozen inputs, including raw candidate IDs.

## 10bps
- Cross-process I0/I1/I2 exact raw SHA pass: [True, True, True].
- Converged I1/I2 byte-identical within each process: {'A': True, 'B': True}.
- Final raw candidate/decision/trade/event/MTM SHA including IDs equal: True.
- Decision counts A/B: [2543, 2523, 2523] / [2543, 2523, 2523].
- Final modeled equity JPY 290070131.972, PF 4.756888, WR 73.0858%, MTM DD -14.514985%, trades 1293.

## 30bps
- Cross-process I0/I1/I2 exact raw SHA pass: [True, True, True].
- Converged I1/I2 byte-identical within each process: {'A': True, 'B': True}.
- Final raw candidate/decision/trade/event/MTM SHA including IDs equal: True.
- Decision counts A/B: [2543, 2523, 2523] / [2543, 2523, 2523].
- Final modeled equity JPY 175324355.253, PF 3.835145, WR 70.2786%, MTM DD -15.014724%, trades 1292.

## Fail-closed limits

- Research in-memory overlay adjustment is not a registered Owner/Route; do not deploy.
- Shared Risk, Margin Guard, Kill Switch, Pending, account lock and dedup parity not fully certified.
- 2025 Aster RENDER H1 mark missing; actual Aster M5 fills/funding not verified.
- Historical periods are previously explored, not untouched OOS.
- No VPS/LIVE/Production/HP/orders changed.
