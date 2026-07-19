# Dis-Dex Manager Resilient Profit Main V35 — Frozen Evidence

## Status

- Strategy ID: `DISDEX_RESILIENT_PROFIT_MAIN_V35`
- Frozen candidate: `S140_N120_B35_NEG0_V0_D0_P30`
- Repository promotion mode: `SHADOW`
- Real trading default: `false`
- Paper/live eligibility: not granted

## Frozen logic

The V28 core remains the direction and symbol-selection engine.
V35 changes only portfolio exposure using signals from the prior completed 12-hour bar.

- Strong Bull core multiplier: `1.40x`
  - BTC above completed 20-day SMA
  - BTC completed 20-day momentum >= `+10%`
  - BTC completed 3-day momentum > `0%`
- Normal Bull core multiplier: `1.20x`
- Brake core multiplier: `0.35x`
  - BTC completed 1-day return <= `-4%`, or
  - maximum ETH/BNB/SOL downside/upside realized-volatility ratio > `1.35`, or
  - BTC below completed 20-day SMA
- Bear core multiplier: `1.00x`
- PENGU active sleeve: `0.30` gross
- PENGU sleeve during brake: `0.15` gross
- Total portfolio gross cap: `2.00`
- Same-bar information is prohibited; feature decision lag is one completed 12-hour bar.

## Backtest evidence

| Period | Return | CAGR | Max DD | Monthly PF |
| --- | ---: | ---: | ---: | ---: |
| 2023–2025 | +712.1907% | +100.9788% | -34.2079% | 3.6949 |
| 2023–2025 Severe | +118.1794% | +29.6917% | -54.0194% | 1.8436 |
| 2026 H1 reused confirmation | +22.0712% | +49.5483% | -11.5952% | 5.0410 |
| 2026 H1 Severe reused | +0.5298% | +1.0720% | -15.4185% | 1.1140 |
| 2023–2026 H1 full | +891.4507% | +92.7327% | -34.2079% | 3.7580 |

Annual normal returns in the development window:

- 2023: `+286.7738%`
- 2024: `+19.5632%`
- 2025: `+75.6319%`

The configuration was selected by the minimum development-qualified gross/leverage rule. 2026 H1 was excluded from ranking and used only as reused confirmation.

## Known limitations

- 2026 H1 is not a pristine untouched holdout because the project had previously observed this market period.
- PENGU evidence contains only the frozen 17-trade schedule.
- Development Severe Max DD is `-54.0194%`; this is not an acceptable live drawdown target.
- The existing VPS Win80 runner is long-only and cannot execute the BTC Bear Short or PENGU Short components faithfully.
- V35 therefore remains shadow-only until a separate long/short portfolio runner and fresh forward evidence pass review.

## Live promotion gate

The immutable production module requires all of the following before a separate reviewed promotion can even be considered:

- at least 30 pristine forward days
- at least 12 completed PENGU trades
- at least 95% market-data coverage
- positive Severe forward return
- Severe forward Max DD no worse than -25%

Even when these evidence checks pass, `liveEligible` remains hard-coded to `false` in V35. Enabling orders requires a separate explicit promotion commit.
