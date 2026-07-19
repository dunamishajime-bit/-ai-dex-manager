# Dis-Dex Manager V35 Evidence Status

## Current status

- Strategy ID: `DISDEX_RESILIENT_PROFIT_MAIN_V35`
- Repository mode: `PAPER`
- Real trading: `false`
- PENGU sleeve: excluded
- Robust Aster production candidate: none
- Dedicated Aster Long/Short runner: implemented

## Deprecated result

The earlier frozen candidate `S140_N120_B35_NEG0_V0_D0_P30` reported:

- 2023–2025 compounded return: +712.1907%
- CAGR: +100.9788%
- MaxDD: -34.2079%

This result is **not valid production evidence** because the PENGU return stream came from 17 fixed historical trade timestamps. Fixed timestamps do not define a reproducible future signal.

Do not use the old +712% result to justify real trading, leverage, capital allocation or VPS live replacement.

## PENGU reproducibility audits

### V36

- 1,539 reproducible one-hour candidates
- Development passed: 14
- Validation passed: 1
- stable neighboring candidates: 0
- selected: none
- status: `NO_ROBUST_PENGU_72H_RULE`

### V38

A fixed RSI14 reversal ensemble across SMA72/120/168 was tested with a one-time Frozen Holdout.

No configuration passed Development, Validation and Frozen Holdout together.

PENGU remains disabled.

## Aster V37 core-only evidence

V28 Core plus BTC Bear Short was recalculated directly from Aster public one-hour OHLCV and funding, excluding all PENGU returns.

Current V35 multipliers:

- Strong Bull: 1.40x
- Normal Bull: 1.20x
- Brake: 0.35x
- Bear: 1.00x

Results:

| Period | Return | CAGR | MaxDD | Monthly PF |
| --- | ---: | ---: | ---: | ---: |
| 2023–2025 | +319.3915% | +61.2473% | -31.7730% | 3.0540 |
| 2023–2025 Severe | +10.1149% | — | -49.7769% | — |
| 2026 H1 reused confirmation | +3.0541% | — | — | — |
| 2026 H1 Severe reused | -14.4419% | — | -24.8182% | — |
| Full period | +332.2003% | +51.9917% | — | — |

V37 grid result:

- Development passed: 0
- robust candidates: 0
- reused-2026 passed: 0
- status: `NO_RESILIENT_V35_CORE_ONLY`

## Implementation completed

The dedicated V35 runner supports:

- V28 ten-member core reconstruction
- VWM25 ranking tilt
- downside-volatility-skew scaling
- four-bar-confirmed BTC Bear Short
- V35 dynamic multipliers
- Aster One-way Long/Short target reconciliation
- reduce-only close before side reversal
- one order per tick
- gross cap
- durable state, execution lock and idempotency
- unknown-order reconciliation
- signed Long/Short paper portfolio
- systemd paper daemon installer

## Promotion boundary

V35 may run as a VPS PAPER daemon for fresh forward evidence.

Real trading remains blocked until a later strategy version produces:

- a robust Aster development cluster
- positive Validation and Frozen/forward Severe results
- acceptable Severe drawdown
- pristine forward evidence
- an explicit reviewed live-promotion commit

See `research/DISDEX_V35_ASTER_REVALIDATION.md` for the full audit and `research/DISDEX_V35_VPS_HANDOFF.md` for the VPS paper-daemon deployment procedure.
