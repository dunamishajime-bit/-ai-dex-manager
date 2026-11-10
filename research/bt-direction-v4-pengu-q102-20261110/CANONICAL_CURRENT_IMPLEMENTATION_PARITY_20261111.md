# Canonical current-implementation parity checkpoint — 2026-11-11

## Status

Task A/B complete for the current implementation-parity model.

Canonical simulator:
`scripts/portfolio_effective_current_canonical_parity_20261111.py`

It combines, in one replay:
- effective runtime caps Crypto 3.0 / Stock 4.0 / Total 4.25;
- exact current V4 adapter replay 1394/1394 plus native Core49;
- V4 Production ranking and private admission semantics;
- Shared Risk crypto-only settled + unrealized 7.5% sticky UTC-day latch;
- PENGU/Q102 flatten vs V4/FET/HYPE/IDLE/V52 entry-block behavior;
- 5-minute risk timing;
- V52 own 3.5% daily strategy latch and Aster 5-minute marking;
- Q102 adopted exits ON;
- FET trailing/cooldown and dynamic gross;
- HYPE full-1.5x pre-cap gate;
- IDLE fill-consumed per-symbol cooldown;
- V11 fail-closed omission with separate sensitivity evidence.

## Source audit resolved

V4 max-DD 21% is a real entry/reservation hold in pin
`53a0be396719f0284af4e11b35c66a4ac7d58f79`.

The state is updated from signed `ACCOUNT_MARK.equityUsd`:
- initial equity peak = initial account equity;
- each account mark raises `equityPeakUsd` when appropriate;
- `maxDrawdown = max(previous, 1 - accountEquity / equityPeak)`;
- new V4 shared reservations are held once `maxDrawdown > 0.21`.

Therefore the canonical replay correctly uses whole modeled account MTM equity, not V4-only PnL, for the 21% V4 entry hold.

V4 gross semantics at the same pin:
- requested leg gross <= 1.0;
- Recovery family <= 2.5;
- V12/V4 active gross <= 3.0;
- new crypto risk uses `resolveCryptoGrossEntryControl(... requestedEntryCap: 3.0)`;
- existing crypto exposure may remain managed up to the separate existing-exposure allowance;
- shared reservation recheck allows crypto envelope <= 3.5 and total <= 4.75;
- total V4 admission <= 4.75.

## Canonical result

Period: 2025-10-01 00:00 UTC to 2026-10-01 00:00 UTC, end-exclusive.
Initial capital: JPY 10,000.

| Cost | Final MTM | Max DD | Fills | Win rate | PF |
|---:|---:|---:|---:|---:|---:|
| 10bps | JPY 235,605.78 | -58.0771% | 446 | 56.7265% | 1.1874 |
| 30bps | JPY 77,865.09 | -65.0500% | 425 | 54.3529% | 1.1232 |

10bps admitted by runner:
V4 131 / Q102 93 / PENGU 63 / IDLE 68 / V52 49 / HYPE 34 / FET 9.

30bps admitted by runner:
V4 130 / Q102 88 / PENGU 54 / IDLE 69 / V52 49 / HYPE 29 / FET 7.

The largest V4 block is the sticky account max-DD hold:
`V4_MAX_DRAWDOWN_21PCT_HOLD = 1204` at both costs.

## Determinism

Two independent full reruns matched:
**21 / 21 output artifacts SHA256 PASS.**

Evidence:
- `evidence/CANONICAL_PARITY_PASS1_SHA256_20261111.txt`
- `evidence/CANONICAL_PARITY_PASS2_SHA256_20261111.txt`

Generated simulator SHA256:
`ebd6324319453da01906bb5c95e9e2da59a0ea6cf630927d68c2f6effe1b31af`

Wrapper source SHA256:
`72b82db1e25273ba2358008c1ccd40b44dd33695b334d5ba9951802be0289701`

## Classification

**CURRENT IMPLEMENTATION PARITY REFERENCE — NOT FULL VENUE EXECUTION PARITY**

Remaining unavoidable limits:
- V50 remains a historical price proxy rather than historical executable-book replay;
- full-year V11 reference/order-book/fill microstructure is unavailable, so V11 is fail-closed omitted in the canonical baseline;
- modeled historical fills are not signed historical venue fills;
- current V4 policy/ranking is implementation-parity replay and contains retrospective development history, so it is not unbiased OOS evidence.

## Next step

Run research A/B only against this canonical baseline:
1. IDLE JUP gate
2. PENGU V8 BTC24 gate
3. Q102 FET ret14 gate
4. pairwise combinations
5. THREE bundle

Do not reuse research improvements measured against the older 772-fill baseline.
