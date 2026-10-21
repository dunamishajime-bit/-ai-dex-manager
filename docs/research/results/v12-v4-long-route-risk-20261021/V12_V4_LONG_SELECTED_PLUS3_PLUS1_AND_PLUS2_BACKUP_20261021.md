# V12 V4 LONG selected +3% -> +1% and +2% reversal backup comparison

> USER SELECTED PRIMARY RULE only; backtested secondary +2% stages rejected. Not LIVE.

## Chosen primary +3% -> +1% profit-guard (two completed bearish H1 closes)

The tested rule applies **only** to X09, X10 and X14 V4 TIME LONG. The user chose the
trade-off as an explicit profit protection policy, despite no observed global MTM DD improvement.

| Cost | Baseline final JPY | Selected final JPY | Final net-profit change | Max DD change | Historical losing trades improved | Historical winners early closed |
|---|---:|---:|---:|---:|---:|---:|
| 10bps | 222,818,967 | 222,373,711 | -445,256 JPY (-0.200%) | +0.0000 pp | 0 | 1 |
| 30bps | 124,289,207 | 123,696,117 | -593,090 JPY (-0.477%) | +0.0000 pp | 0 | 1 |

## Separate +2% peak backup research (NOT approved)

Three alternative +2% tier thresholds, each overridden by the selected +3% -> +1%
when a historical MFE has touched +3%. All variants require two completed bearish H1 closes.

| Backup threshold after +2% MFE | Final difference 10bps | Final difference 30bps | Max DD delta 10bps | Max DD delta 30bps | Losers improved 10bps | Winners exited early 10bps |
|---|---:|---:|---:|---:|---:|---:|
| STAGED_X_2P_TO_MINUS2P_3P_TO_PLUS1P | -156,490 | -3,196,577 | -0.0075pp | -0.0319pp | 0 | 3 |
| STAGED_X_2P_TO_MINUS1P_3P_TO_PLUS1P | +437,108 | -3,219,282 | -0.0012pp | -0.0321pp | 1 | 3 |
| STAGED_X_2P_TO_BREAK_EVEN_3P_TO_PLUS1P | -2,598,630 | -6,269,843 | -0.0022pp | -0.0163pp | 2 | 5 |

### Verdict

No +2% fallback passes the both-costs +0.10 percentage-point max DD improvement gate.
Reject these three backup configurations and do NOT silently extend primary profit
guard to every TIME route. The +2% to +2.999% peak reversal risk remains an
open research problem. The selected +3% rule is not an assured +1% execution floor.

### Venue implementation constraint

Current TIME V4 LONG emergency resident STOP is entry price x 0.92.
Runtime rejects LONG protective STOP at or above entry, and recomputes -8%
at recovery. Thus applying a +1% resident STOP requires a durable, exact
readback verified, monotonic STOP-upgrade lifecycle; ordinary market EXIT at
the next M5 after confirmed H1 cannot guarantee +1% actual execution.

Do not restart/deploy/run LIVE with this candidate or alter operator artifacts.
Protect resident STOP and remaining actual positions before any future
backtested implementation. New Task9 engine and current Production parity
have not yet been independently certified.

Source: scripts/dd-reduction/run-task9-v4-long-staged-profit-20261021.py
Unit tests: scripts/dd-reduction/test-v4-long-staged-profit-20261021.py
Raw full8 model scenario ledgers retained on the owner PC research folder.
