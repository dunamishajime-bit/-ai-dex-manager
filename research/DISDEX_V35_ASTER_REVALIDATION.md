# Dis-Dex V35 Aster Revalidation

## Result

The dedicated V35 Aster long/short runner is implemented, but the strategy did not pass the live-promotion research gates.

## PENGU V36

The old integrated V35 result used 17 fixed historical PENGU trade timestamps. Those timestamps are evidence samples, not a future signal rule.

V36 tested reproducible one-hour PENGU Long/Short rules:

- decision every six hours
- entry at the next one-hour open
- fixed 72-hour hold
- no overlapping PENGU positions
- Development 50%, Validation 25%, Frozen Holdout 25%
- fees, funding and Severe costs included

Result:

- candidates: 1,539
- Development passed: 14
- Validation passed: 1
- stable neighboring candidates: 0
- Frozen candidate: none
- status: `NO_ROBUST_PENGU_72H_RULE`

## PENGU V38

A fixed RSI14 reversal ensemble using SMA72/120/168 was tested after the V36 validation cluster was observed. Two matching votes were required.

No ensemble passed Development, Validation and the one-time Frozen Holdout together.

Examples:

- threshold 35 / no BTC filter: Frozen -14.0052%, PF 0.8524, Severe -17.1941%
- threshold 30 / risk filter: Development -3.9947%, Frozen +19.4606%, Severe +15.6873%
- threshold 35 / risk filter: Validation -7.2260%, Frozen +2.6679%, Severe -0.9402%

The direction is unstable across periods. PENGU is excluded from the production configuration.

## V37 Aster core-only

V28 Core plus the confirmed BTC Bear Short was recalculated directly from Aster public one-hour OHLCV and funding. No PENGU return stream was included.

The exact V35 multipliers `Strong 1.40 / Normal 1.20 / Brake 0.35 / Bear 1.00` produced:

- 2023–2025 compounded return: +319.3915%
- 2023–2025 CAGR: 61.2473%
- 2023–2025 MaxDD: -31.7730%
- monthly PF: 3.0540
- Development Severe: +10.1149%
- Development Severe MaxDD: -49.7769%
- reused 2026 H1: +3.0541%
- reused 2026 H1 Severe: -14.4419%
- reused 2026 H1 Severe MaxDD: -24.8182%
- full compounded return: +332.2003%
- full CAGR: 51.9917%

Across the V37 multiplier and brake grid:

- Development passed: 0
- robust candidates: 0
- reused-2026 final passed: 0
- status: `NO_RESILIENT_V35_CORE_ONLY`

## Implementation status

Implemented:

- V28 ten-member core reconstruction
- VWM25 rank tilt
- downside-volatility skew scaling
- four-bar-confirmed BTC Bear Short
- V35 dynamic multipliers
- signed Long/Short Aster portfolio targets
- reduce-only side reversal
- durable state, lock, idempotency and unknown-order reconciliation
- signed futures paper executor
- systemd replacement installer

Not authorized:

- real order placement
- replacing a currently profitable live process with V35
- enabling the rejected PENGU sleeve
- setting the repository or environment live flags to true

The V35 daemon may run in PAPER mode for fresh forward collection. A later promotion requires a robust Aster backtest plus pristine forward evidence.
