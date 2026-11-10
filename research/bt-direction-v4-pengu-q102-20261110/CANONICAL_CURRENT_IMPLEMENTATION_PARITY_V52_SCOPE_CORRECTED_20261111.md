# Canonical current-implementation parity — V52 strategy-capital corrected — 2026-11-11

## Status

**LOCKED CURRENT-IMPLEMENTATION PARITY BASELINE (execution-model caveats remain).**

This supersedes the pre-V52-strategy-capital canonical result.

No Production mutation was performed.

## Period / assumptions

- Period: 2025-10-01 00:00 UTC <= t < 2026-10-01 00:00 UTC
- Initial capital: JPY 10,000
- Cost models: 10bps and 30bps
- Q102 adopted exits: ON, matching effective Production env
- FET trailing: ON, matching effective Production env
- Effective shared caps used: Crypto 3.0x / Stock 4.0x / Total 4.25x / Shared daily loss 7.5%
- V4 private envelope: requested leg <=1.0x / V4 aggregate 3.0x / Recovery 2.5x / V4 total envelope 4.75x / DD hold 21%
- Effective active V52 source audited: 8495daf24e53a6cf0dd5e38f022008fa8f78c688

## V52 strategy-capital correction

The previous canonical replay subtracted all non-V52 crypto notional from the V52 daily-loss denominator.

Effective Production inherits current_v96_notional() from disdex_v11eq_aster_only_live_engine and scopes it to these 15 crypto symbols only:

BTC, ETH, BNB, SOL, LINK, AVAX, DOGE, INJ, XRP, ADA, LTC, ATOM, AAVE, NEAR, PENGU.

The corrected replay:

- subtracts marked notional only for those 15 symbols,
- excludes pending exposure from this denominator,
- uses current marked notional,
- keeps reserve = max($5-equivalent, 10% portfolio equity),
- keeps DISDEX_V52_MAX_DAILY_LOSS_PCT=3.5.

## Locked results

| Cost | Final MTM | Max DD | Closed fills | Win rate | PF | Shared-risk trips | V52 daily trips |
|---|---:|---:|---:|---:|---:|---:|---:|
| 10bps | JPY 887,336.06 | -56.31% | 537 | 57.36% | 1.222 | 20 | 38 |
| 30bps | JPY 321,161.96 | -63.20% | 537 | 56.24% | 1.168 | 21 | 42 |

Source intents: 2,811. Missing exit models: none. Terminal open positions: 1, MTM at period end without synthetic exit fee.

## Determinism

The corrected canonical replay was executed twice independently.

- Pass1 artifacts: 21
- Pass2 artifacts: 21
- SHA256 exact match: **21/21**

Wrapper SHA256:
`eba62b627ae78929de28a3274e9afadaf5204af05527996c47ce7ef6b14018c6`

Generated simulator SHA256:
`370a6066df383a1e5f5f89486a820089db3fddf2526ee42ccf37031f53fd610f`

Checkpoint commit containing the V52 denominator fix:
`a94458e23036dca9277dcb3bc0450a5b454719ac`

## Important limitations

This is the best current-implementation replay baseline, not a claim of exact historical venue-fill reconstruction.

- V52 V11 full-period microstructure/executable-book evidence is not available, so V11 remains fail-closed/missing from the modeled historical execution path.
- V52 V50 is still an implementation-oriented proxy where historical exact executable-book/fill evidence is unavailable.
- V4 current-policy replay is implementation parity, not unbiased OOS evidence; its policy/ranking was developed using later information.
- Historical actual Aster fills cannot be reconstructed for the full year from the available V52 audit log.
- Therefore use this baseline for controlled same-data A/B research, not as certified realized historical PnL.

## Supersession

The earlier canonical result around JPY 235,606 / JPY 77,865 is retained only as historical evidence and is superseded because its V52 strategy-capital denominator was too small.

Research-gate A/B results produced before this correction are also superseded and must be rerun on this locked baseline.
