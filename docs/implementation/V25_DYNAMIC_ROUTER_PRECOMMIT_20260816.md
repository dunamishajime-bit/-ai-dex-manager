# V25 Dynamic Router — Precommit

Status: research-only preregistration before V24 result is read.

## Fixed universe and boundaries

- Dynamic Binance USD-M universe: BTC, ETH, BNB, SOL, LINK, AVAX, DOGE, INJ, PENGU.
- A symbol participates only after its own 50 completed 12H bars.
- Historical design window: 2023-07-01 <= t < 2026-07-01.
- Development / Validation / Evaluation boundaries remain 2024-07-01 and 2025-07-01.
- One position maximum, gross exposure <=100%, leverage multiplier 1.0.
- Normal round-trip cost 10 bps; Stress 30 bps plus 1H execution delay.
- No symbol-specific parameter, year-specific parameter, parameter grid, or Fresh OOS.

## Router

At each globally anchored 84H checkpoint:

1. Build the same common 12H SMA50 and 20-bar normalized-momentum features used by V23/V24.
2. BROAD mode: if strictly more than half of currently available symbols have close>SMA50 and 20-bar momentum>0, rank those symbols by normalized 20-bar momentum and own the strongest. Existing owner may be retained while it remains in the BROAD top-2.
3. NARROW mode: otherwise, among symbols with close>SMA50, positive 20-bar momentum, and close above the previous 20 completed 12H-bar high, own the highest normalized-momentum symbol.
4. If neither mode offers a candidate, hold CASH.
5. A mode transition is allowed only at the same 84H checkpoints; there are no intra-cycle stops, trailing exits, or rescue rules.

## Selection policy

V25 is a deterministic union of the two architectures already frozen as V23 (BROAD) and V24 (NARROW). No V23/V24 result is allowed to change this router. V25 must be evaluated exactly once under this definition before any further structural diagnosis.

Production, VPS, LIVE and order paths are explicitly out of scope.
