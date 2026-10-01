# CURRENT LIVE TARGET — Trail0.20 + Idle + DOGE/AVAX residual

**Status:** CURRENT_CANONICAL_PRODUCTION_TARGET  
**Date:** 2026-10-02  
**Production base before this promotion:** `8e341956b3c5c5d825029d18ba083029d919126b`  
**Implementation readiness:** READY  
**Real-money activation:** BLOCKED until the exact-SHA Production workflow creates the root-owned operator activation artifact and verifies the cutover.

This file and `docs/production/current-live-target.json` are the single current Production activation target. Older backtests remain historical evidence only.

## Current strategy contract

- V12: existing entry logic retained; maximum 3 positions; Rank3 0.10x and score >= 0.70.
- V12 exit: initial STOP 2.477 ATR, TP 3.1995 ATR, trailing ATR **0.20**. Trailing replacement is computed from the completed 2H favourable high/low for the next block.
- PENGU: current COMBINED_FILTERED production behavior retained.
- Q102: current Causal V4 / one-slot / DD-governor behavior retained.
- FET: current BRK48 residual behavior retained.
- V52: current Production stock behavior retained.
- Idle Priority SHORT: exact historical 61-trade parity is preserved for TAO/TIA/DOT/JUP/RENDER.
- Residual LONG:
  - DOGE: BTC-relative 24h >= +3%, Volume Ratio >= 1.20, ATR Ratio >= 0.7%.
  - AVAX: BTC-relative 24h >= +3%, Volume Ratio >= 0.80, ATR Ratio >= 0.7%.
  - both are LONG, Gross 1.00x, Aster 5x Cross, 12h natural hold, 10% emergency STOP, 25% TP.
- Priority is fixed: **Formal existing > Idle Priority SHORT > DOGE > AVAX**.
- V12/PENGU/Q102/FET/V52 all have explicit residual preemption wiring. Residual preemption is reduce-only and fail-closed.
- Portfolio caps remain Crypto 3.0x / Total 4.25x, with existing hard/govenor protections and Shared Crypto Daily Loss 7.5%.

## Controlling formal evidence

Source:
`docs/research/results/trail020-idle-doge-avax-controlling-20261002/controlling-contract.json`

SHA256:
`FEDE715DAB4822417B1F052F36478EE2BF883A70DAE1E4161CA400AF07D02729`

Selected case:
`trail020_idle_doge_avax_20261002`

Period: 2025-08-10 through 2026-08-10.

| Cost | Ending asset | Win rate | PF | Max MTM DD | Trades |
|---|---:|---:|---:|---:|---:|
| 8bps | JPY 1,664,976,130.49 | 67.9137% | 2.383908 | -21.2439% | 1,390 |
| **10bps controlling** | **JPY 1,319,918,378.81** | **67.0504%** | **2.332298** | **-21.3596%** | **1,390** |
| 20bps | JPY 418,296,811.09 | 61.8156% | 2.091630 | -22.2766% | 1,388 |
| 30bps | JPY 118,566,758.74 | 56.8017% | 1.874744 | -23.3606% | 1,382 |

10bps routing:
V12 1,011 / PENGU 61 / Q102 130 / V52 85 / FET 15 / Idle SHORT 61 / DOGE 11 / AVAX 16.

The promotion drawdown floor for this operator-approved target is **-25%**. The actual controlling result is -21.36%, and the 30bps stress remains above the floor at -23.36%.

## Reuse

The controlling artifact directory contains 8/10/20/30bps:
- full integrated result,
- `portfolio-trades.jsonl`,
- metrics,
- frozen priority overlay intents,
- exact machine-readable contract,
- SHA256 manifest.

Run:
`python scripts/replay-trail020-idle-doge-avax-ledger-20261002.py --bps 10`
to revalidate the frozen ledger.

## Activation rule

No source commit is LIVE merely because it is merged or pushed. The exact-SHA Production workflow must:
1. regenerate both Idle parity certificates for that SHA,
2. prove current Production is an ancestor,
3. verify no unsafe pending exposure, Kill Switch false, fresh Margin Guard and Shared Risk,
4. create the root-owned operator activation artifact for that exact SHA/target,
5. cut over all runners,
6. verify one runtime SHA, LIVE services, and HP/API safety.

Do not bypass a failed gate or use a synthetic LIVE order to prove activation.
