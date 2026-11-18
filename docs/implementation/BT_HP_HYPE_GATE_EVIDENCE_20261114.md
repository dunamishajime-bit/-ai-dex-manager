# BT #481 — HYPE Historical Gate Evidence Audit (2026-11-14)

## Scope and operational boundary

This is a read-only post-analysis of historical STABLE4 research-model records, not a rerun of LIVE-pinned HYPE or an instruction to operate any runner. V4 runtime work is explicitly handled by Codex, not this PR.

Source cases: 2025-10-01 00:00 UTC to 2026-10-01 00:00 UTC (exclusive), 10bps and 30bps, sourced from the unmodified model-engine Gross observer's private evidence CSV files.

| Historical source | 10bps | 30bps |
| --- | ---: | ---: |
| HYPE admitted model entries | 5 | 5 |
| Model wins | 3 | 3 |
| Model losses | 2 | 2 |
| Historical as-of Kill Switch evidence | 0 / 5 | 0 / 5 |
| Historical as-of V4 STOP ownership evidence | 0 / 5 | 0 / 5 |
| Historical as-of Gross and market-data evidence | 0 / 5 | 0 / 5 |

**Gate verdict: `HISTORICAL_GATES_UNVERIFIED`. Economic parity: false.**

Historical entries were matched one-to-one across the cost cases by signal ID, UTC event, symbol, route, source SHA and exit UTC. This is evidence that the old model contained five corresponding HYPE trades, **not** evidence that any of those trades would pass current LIVE gates. The two losing and three winning outcomes cannot be selectively removed as an 'improvement'; exclusion changes later account equity, arbitration, capacity, risk gates and compounding.

## Repeatable offline inspection

Use `scripts/bt_hp_hype_asof_gate_audit.py` with `--entries10`, `--fills10`, `--entries30`, `--fills30`, and `--output` set to private local paths. The optional `--gate-proof` CSV must supply source signal ID, UTC entry, symbol, route, `observed_utc`, and `shared_kill_switch`, `v4_stop_ownership`, `shared_gross`, `market_data` Gate values, each `PASS` or `BLOCK`. Observed timestamps must not be later than entry or more than five minutes before it. Missing proof stays UNKNOWN, not presumed PASS. Gate proof alone still cannot certify full LIVE economics.

Offline proof result file, not checked into GitHub: `C:\tmp\bt481-hype-asof-gate-audit-20261114.json`.

SHA256 of the private audit result: `BE071FAF00975DE1494DC36574C27039E66EA3BD41D4F4FE01632616F38B6188`.

The private account, venue and trade ledgers remain off GitHub. No exchange order, STOP, V4/HYPE service, LIVE configuration, public HP or deployment approval was altered by this audit.

## Next blocking evidence

Obtain the original historic as-of Kill Switch state and V4 STOP ownership / shared Gross / market-data snapshots (with immutable source hashes), check that no future state is used, then rerun the source-strategy portfolio with those gates. Recompute 10/30bps fills, DD, compounded equity, Gross and all competing logic allocation, rather than applying retrospective PnL adjustments.