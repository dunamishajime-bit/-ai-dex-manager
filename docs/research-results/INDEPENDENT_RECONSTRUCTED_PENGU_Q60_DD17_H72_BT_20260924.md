# Independent one-year integrated BT: new PENGU Q60 + DD17/H72

## Scope

This is an independently reconstructed, source-labelled backtest. It is not a
canonical production-anchor parity result because the exact canonical V12 Top3
event ledger is not available in the accessible research bundle. The engine
therefore uses the recovered V12 Top2 ledger and records that limitation in the
JSON output.

The new PENGU is the requested variant:

- `COMBINED_FILTERED`
- every accepted entry Gross `1.0`
- same-route hard-stop quarantine `60h`
- realized PENGU DD threshold `-17%`
- new-entry governor hold `72h`

Period: `2025-08-10T00:00:00Z` inclusive through `2026-08-10T00:00:00Z`
exclusive. Capital is initial `¥10,000` plus `¥10,000` on each of the next
12 monthly dates (`¥130,000` total contributed), with compounding enabled.

## Integrated result

| Metric | NORMAL | SEVERE |
|---|---:|---:|
| Ending equity | ¥2,243,087,644.44 | ¥39,869,761.23 |
| Return on contributions | 1,725,352.03% | 30,569.05% |
| Profit factor | 2.70309307 | 1.62506304 |
| Max drawdown | -22.2972% | -32.2208% |
| Accepted portfolio trades | 1,079 | 1,045 |
| Accepted PENGU trades | 59 | 57 |
| Rejected entries | 158 | 191 |
| Gross conflicts | 0 | 0 |
| FET preemptions | 4 | 6 |

The SEVERE scenario applies the generated V52 ledger with the 100bps stock
round-trip cost case; NORMAL uses 40bps. These results are independent
reconstruction outputs, not a claim that the historical canonical anchor was
reproduced.

## New PENGU standalone source result

The selected `Q60_DD170_H72` ledger itself contains:

| Metric | NORMAL | SEVERE |
|---|---:|---:|
| Closed trades | 69 | 68 |
| Return | 1,536.60097% | 843.23951% |
| Profit factor | 4.60930988 | 3.39660719 |
| Max drawdown | -15.0548% | -16.9887% |

In the integrated replay, Gross competition and the PENGU governor reduce the
accepted PENGU counts to 59 and 57. Rejected entries are not included in PENGU
realized PnL or governor state.

## Logic-level integrated PnL

| Logic | NORMAL PnL | NORMAL trades | SEVERE PnL | SEVERE trades |
|---|---:|---:|---:|---:|
| V12 | ¥540,486,919.54 | 731 | ¥12,712,649.73 | 718 |
| PENGU | ¥220,522,983.64 | 59 | ¥7,405,475.99 | 57 |
| FET | ¥118,604,837.28 | 15 | ¥5,371,226.35 | 14 |
| Q102 | ¥717,867,877.36 | 82 | ¥25,926,687.27 | 79 |
| V52 | ¥645,475,026.62 | 192 | -¥11,676,278.11 | 177 |

These PnL figures are the engine's compounded close-event contributions and
must not be added as if they were independent sleeve backtests.

## Gross and rejection checks

| Metric | NORMAL | SEVERE |
|---|---:|---:|
| Max Crypto Gross | 4.98064x | 4.98150x |
| Max Total Gross | 8.00000x | 7.91688x |
| Max FET Gross | 2.25x | 2.25x |
| Shared Gross cap rejects | 126 | 167 |
| PENGU governor rejects | 3 | 2 |
| V52 two-slot rejects | 29 | 22 |
| FET preemptions | 4 | 6 |

The engine performed a separate TDD check to ensure stock entries consume Total
Gross but do not falsely count against Crypto Gross. The final run reports
`grossConflicts=0` in both modes. No synthetic or live order is produced by
this BT.

## Monthly ending equity

| Month | NORMAL | SEVERE |
|---|---:|---:|
| 2025-08 | ¥17,102.54 | ¥10,298.28 |
| 2025-09 | ¥52,263.53 | ¥25,954.22 |
| 2025-10 | ¥227,769.94 | ¥70,703.29 |
| 2025-11 | ¥2,101,285.86 | ¥392,473.37 |
| 2025-12 | ¥3,539,064.02 | ¥572,527.08 |
| 2026-01 | ¥29,503,359.15 | ¥3,906,249.83 |
| 2026-02 | ¥56,824,198.81 | ¥5,967,677.59 |
| 2026-03 | ¥145,460,762.62 | ¥11,471,590.63 |
| 2026-04 | ¥268,834,531.57 | ¥13,725,605.91 |
| 2026-05 | ¥466,791,835.09 | ¥19,781,334.50 |
| 2026-06 | ¥1,727,803,945.58 | ¥45,599,640.72 |
| 2026-07 | ¥2,062,958,983.09 | ¥38,064,616.67 |

The twelfth monthly contribution occurs at the period endpoint (`2026-08-10`)
and is included in the final equity/capital total, while the monthly table is
shown through the last complete calendar month inside the interval.

## Reproducibility inputs

| Input | SHA-256 |
|---|---|
| recovered V12 Top2 ledger | `f75ca1d25c65b17539c82cf0b48a34017be998ab2a86a161e2701e69301b7403` |
| new PENGU Q60/DD17/H72 result | `f89b888600f5e817741e79cb4aaeb913741f931c2dc45fcb56b1583d583469fb` |
| Q102 Causal CSV | `832f9a723fbb95b8a57201f67e51687bb07b33120851940328de1b3ba0e9567b` |
| FET BRK48 ledger | `888d5c4502705782151dbab87eefe1f00668d2b6e923869e3c98797d1b7ca540` |
| generated V52 stock ledger | `89390d14d6e04bf26a3214e2b3220c300d194123a75bfb0f23877dd263da9651` |

The generated JSON result contains the complete event ledger, source paths,
assumptions, monthly equity, and both scenario outputs. Re-running the same
engine with the same five inputs produced the same output SHA-256:

`A80D6FD235BD3E44C5D2620FA5DCB42B4F63A58983425BFE745A991ED0139F4C`

## Verification status

- New PENGU contract tests: PASS (`2/2` TypeScript tests).
- Integrated engine contract tests: PASS (`3/3` Python tests).
- Source compilation check: PASS.
- Deterministic rerun: PASS.
- Formal canonical parity: **BLOCKED**, because the exact canonical V12 Top3
  ledger and original integrated event ordering/source bundle are unavailable.

This artifact is therefore suitable as a reproducible independent one-year
reconstruction using the new PENGU logic, but it must not be labelled as the
formal canonical production BT until the missing Top3 canonical source bundle
is supplied.
