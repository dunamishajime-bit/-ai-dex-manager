# FET +3% Profit Floor Integrated BT Evidence — 2026-10-06

This evidence changes only the FET BRK48 LONG post-trigger fixed profit floor.

- +5% trigger: unchanged
- protected floor: +0.5% -> +3.0%
- no peak trailing
- initial hard stop: -5% unchanged
- 72h entry gate: >= +2% unchanged
- 24h max hold unchanged
- post-exit cooldown: 24h unchanged
- FET Gross: 1.0 unchanged
- all other strategy logic unchanged

Integrated 10bps result:

- Final equity: JPY 4,268,873,845.1163716
- PF: 2.9637157881041185
- Max MTM DD: -12.96457052048714%
- Closed trades: 1,358
- FET: 8 trades / JPY 119,064,702.59208399
- V12: 995 trades / 643 wins / 352 losses
- Ownership conflicts: 0
- Accounting: PASS

The H1 causal convention is unchanged: a +5% trigger observed inside an H1 bar cannot retroactively protect an earlier low in that same bar. The +3% floor is active from the following hour.

Files:
- summary.json: exact integrated summary
- portfolio-trades.jsonl: full 1,358-trade ledger
- fet-exit-changes.json: candidate lifecycle changes caused by the +3% floor
- ledger-manifest.json: SHA256 and byte sizes
