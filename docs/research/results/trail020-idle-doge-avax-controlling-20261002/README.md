# Trail0.20 + Idle SHORT + DOGE/AVAX controlling stack — 2026-10-02

Status: CONTROLLING_PRODUCTION_CANDIDATE_NOT_LIVE

Priority: Formal existing > Idle Priority SHORT > DOGE Relative+Volume LONG > AVAX Relative LONG.

10bps controlling result:
- final JPY 1319918378.81
- trades 1390
- win rate 67.0504%
- PF 2.332298
- max MTM DD -21.3596%
- counts {"FET": 15, "IDLE_PRIORITY_SHORT": 61, "PENGU": 61, "Q102": 130, "RESCUE_NEW": 16, "RESCUE_TOP3": 11, "V12": 1011, "V52": 85}

8/20/30bps endpoints:
- 8bps JPY 1664976130.49 / PF 2.383908 / DD -21.2439%
- 20bps JPY 418296811.09 / PF 2.091630 / DD -22.2766%
- 30bps JPY 118566758.74 / PF 1.874744 / DD -23.3606%

Reuse:
- each cost folder contains full integrated-result.json, portfolio-trades.jsonl, metrics.json and rejections.jsonl.
- portfolio-trades.jsonl is the frozen closed-trade ledger used for instant replay and strategy-level aggregation.
- rejections.jsonl preserves the rejected candidate/audit trail for the same cost run.
- replay-ledger.py rebuilds trade count, win rate, profit factor and strategy counts directly from the frozen ledger and asserts parity with metrics.json.
- priority-overlay-intents.json is the frozen 61 Idle + accepted DOGE/AVAX schedule.
- controlling-contract.json is the machine-readable promotion contract.
- manifest.json binds every artifact by canonical LF SHA256 so verification is OS-independent.

No LIVE status is asserted by this research package.
