# Q102 RENDER BRK168 route-health audit — 2026-11-12

Research only; no Production or pin change.

- Route: RENDER|BRK168_H12_V1.2
- Pretarget Binance proxy: 16 cases, 6W/10L, PF 0.895.
- Aster true forward: 3 cases, 1W/2L, PF 0.077.
- Existing 64-policy route-health jitter: 28/28 eligible policies block; stableBlock=true.
- Current-best integrated 30bps: 1650120 JPY -> 1747707 JPY, PF 1.656 -> 1.691, DD -24.57% -> -24.57%.
- Current-best integrated 10bps: 4757774 JPY -> 5038683 JPY; DD unchanged at -23.81%.
- The opposite-direction shadow is not adopted; its pretarget evidence is also weak.

Decision: carry full route quarantine forward as a research/adoption candidate. This is a frozen route-level decision, not a target-tuned threshold. The stricter single 90d/minN5 policy is noted as a caution because it is not eligible on only three recent pretarget cases.
