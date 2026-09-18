# Idle Capital DD Mitigation Research ? 2026-09-18

Status: **PASS_RESEARCH_ONLY**

Only Q102 gross sizing was changed. V12, PENGU and V52 signals/gross/exits were held unchanged. Portfolio Crypto Gross 3.0x / Total Gross 3.5x remained unchanged.

## Best tested point under strict 20% DD

Q102 family caps:
- HIGH_VOL: 1.665x
- MR: 1.0x
- BRK: 2.475x
- REV: 2.5x
- PB: 2.5x

| Scenario | Asset | PF | DD | Trades |
|---|---:|---:|---:|---:|
| NORMAL | ?200,212,840.10 | 3.84957445 | -19.35894780% | 1221 |
| SEVERE | ?23,687,637.26 | 2.80751006 | -19.99482558% | 1078 |

Versus CURRENT 1.5x, NORMAL asset uplift is 188.60% and SEVERE uplift is 171.36%.
This retains 95.73% of fixed-2.5x NORMAL ending asset and 97.55% of fixed-2.5x SEVERE ending asset, while improving DD by 8.61pt NORMAL / 8.89pt SEVERE.

## Boundary

- HV 1.67 / BRK 2.475: SEVERE DD -20.0083% -> fails strict 20%.
- HV 1.66 / BRK 2.477: SEVERE DD -20.0044% -> fails strict 20%.
- Therefore the tested frontier is approximately HV 1.665 / BRK 2.475 with REV/PB 2.5 and MR 1.0.

## DD diagnosis

Fixed Q102 2.5x DD was driven primarily by a HIGH_VOL ENA loss around 2025-10-19. Once HIGH_VOL is capped, the next limiting Q102 drawdown comes from BRK/REV losses in September 2025. The remaining SEVERE floor near -19.2447% occurs in July 2026 from the core portfolio with no Q102 event in that maximum-DD window.

Research only. No LIVE/VPS/production/orders changed.
