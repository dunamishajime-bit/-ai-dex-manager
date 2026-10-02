# Formal H1 causal BT - V12/Q102 priority + actual-exit cooldown

Status: **official 10bps research result selected; canonical ledgers uploaded and SHA256-pinned.**

The official production-change reference is:

- final equity: **JPY 1,229,065,462.0472791**
- PF: **2.4887028036012624**
- maximum MTM DD: **-21.296368751349548%**
- win rate: **65.17647058823529%**
- closed trades: **1,275**
- accounting reconciliation: **PASS**
- period: 2025-08-10 through 2026-08-10
- round-trip cost: **10 bps**

See `formal-bt-summary.json` for the full frozen metric contract.

Expected canonical ledgers for this result:

- `PRICE_MODEL_10BPS/portfolio-trades.jsonl`
- `PRICE_MODEL_10BPS/candidate-decisions.jsonl`

The model is a causal H1 price model using Aster market/funding data plus the verified V52 stock ledger path. It is **not** historical order-book/L2 fill verification.

The accepted-intent diagnostic replay that previously produced materially larger wealth figures is not the official result for this production change.
