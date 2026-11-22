# P63 — Native V20: Gross 1.0 proposal vs hard-stop loss concentration

Original source SHA 1657e173d250ad58f53e62f7bb0a3428fb405496, original source53 29 wins/24 losses; per original 53 source 14 HARD_STOP losses, each -8.3% at 30bps. HARD_STOP contributed 82.676255% of all losing notional return magnitude; time exits contribute the remainder.

One-slot independent overlapping price model selects 33 source trade intents (18 wins 15 losses) and 8 hard stops; hard stop loss share 81.281122% of original33 losers' notional-loss magnitude.

| Gross | Fee | Cover extra | Wins / closed | M5 high DD | Final NAV JPY |
|---|---:|---:|---:|---:|---:|
| 0.5 | 10bps | 0bps | 18/33 | 17.01952% | 13216.72 |
| 0.5 | 30bps | 0bps | 18/33 | 17.44914% | 12790.72 |
| 0.5 | 30bps | 100bps | 16/33 | 20.31214% | 10882.09 |
| 0.75 | 10bps | 0bps | 18/33 | 24.5037% | 14906.19 |
| 0.75 | 30bps | 0bps | 18/33 | 25.10029% | 14193.07 |
| 0.75 | 30bps | 100bps | 16/33 | 29.11924% | 11136.43 |
| 1.0 | 10bps | 0bps | 18/33 | 31.37732% | 16606.42 |
| 1.0 | 30bps | 0bps | 18/33 | 32.11305% | 15557.46 |
| 1.0 | 30bps | 100bps | 16/33 | 37.11247% | 11254.4 |
| 1.25 | 10bps | 0bps | 18/33 | 37.68908% | 18280.18 |
| 1.25 | 30bps | 0bps | 18/33 | 38.53887% | 16849.87 |
| 1.25 | 30bps | 100bps | 16/33 | 44.35176% | 11232.63 |

**Decision:** Gross 1.0 in unchanged original native model increases 30bps DD 25.10% to 32.11%, and +100bps buy-cover stress to 37.11%. Gross1 should be a RESEARCH TARGET, not deployed.

Refocus on loss-tail and STOP trigger fidelity while preserving rare large native wins. Do NOT widen/remove 8% emergency hard stop. Model ex-ante failed rebound / trend regime change and test damage containment BEFORE native protective hard stop, with venue M5/STOP fill priority. Evaluate DD <=20%, compound NAV >= original and robust fees, not win-rate alone.

This is no LIVE action, no real account DD, signed fills or shared multi-runner gross. Research artifacts only.
