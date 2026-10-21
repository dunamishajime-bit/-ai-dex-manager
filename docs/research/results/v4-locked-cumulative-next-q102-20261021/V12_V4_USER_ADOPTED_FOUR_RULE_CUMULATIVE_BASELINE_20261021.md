# V12 V4 4-rule user-adopted reference for all later full8 integrated BT

**Research baseline pinned, not authenticated LIVE. Never revert V4 to prior source in future comparisons.**

2025-08-10 to 2026-08-10. JPY 10,000 starting capital; no later deposits; compounding; 8 strategies; 10bps normal / 30bps stress.

| V4 4-rule fixed cumulative reference | 10bps | 30bps |
|---|---:|---:|
| Final JPY | 191,750,055.3269 | 74,740,267.7841 |
| Max MTM DD (%) | -14.6033 | -15.7782 |
| PF | 3.1750 | 2.5811 |
| Closed trades | 1,319.0000 | 1,316.0000 |
| Accepted initial SHORT stops | 52.0000 | 51.0000 |

All4 simultaneous and short 12h cooldown replayed from accepted initial-STOP events to a fixed point (not from mere unfilled candidates). Source is a price model; signed venue/L2 and latest independent Task9 TypeScript parity still need certification.

## Locked policies

- LONG: TIME37 MFE >=+2% -> entry -5% resident-like stop (original -8%); X09/X10/X14 profit +3% -> +1% after 2 closed bearish H1.
- SHORT: 12h, MFE <+1%, adverse +2.5% initial exit with same-symbol SHORT 12h admitted-stop cooldown; TIME37 profit +5% -> +2% after 2 closed bullish H1.
- ATR3/NATIVE1 LONG no new stop. ATR3/NATIVE1 SHORT only initial exit applies. PENGU and peer strategies unchanged.

## Continuation contract

- All new Q102/HYPE/Idle/etc candidate studies must start with this baseline intact and rerun full8 dynamic candidate admissions, position overlap, accepted gross and MTM DD, 10bps/30bps.
- Previously modeled isolated overlays or default source baseline must not replace the four-rule fixed model.
- LIVE runtime/actual exchange verification is separate; no deployment is implied.
