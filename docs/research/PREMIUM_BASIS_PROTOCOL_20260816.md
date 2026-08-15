# Premium/Basis Research Protocol — 2026-08-16

## Reason for a new line

The OHLCV-only 2023-07 to 2026-07 architecture line is closed by `OVERFIT_FREEZE_20260816.md`. No V17 may be derived merely by further reorganizing the same inspected price features.

The next research line is allowed only because it introduces a genuinely new causal input: Binance USD-M Futures **Premium Index 1h** history from the official monthly Data Collection archive.

## Data probe status

Before any Premium-based strategy result was calculated, a data-only probe checked BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, LINKUSDT, AVAXUSDT across representative months from 2021-01 through 2026-06.

- 48 requested archives
- 48 valid archives
- 12 columns consistently
- hourly timestamp sequences strictly increasing
- no strategy, return, PnL, or numeric premium values emitted by the probe

## Evidence partitions fixed before Premium strategy results

### Premium Design / inspected price window

- 2023-07-01 through 2026-07-01
- Price behavior in this window is already inspected from the prior research line.
- Premium values are new information.
- Exactly one Premium architecture may be defined before its first result.
- This window is not Fresh OOS.

### Blind Prehistory Validation

- 2021-01-01 through 2022-09-01
- Reserved before any Premium strategy result is viewed.
- No candidate selection, threshold selection, or architecture change may use this interval before the candidate is frozen.
- The first Premium candidate may access this interval only after its architecture and source hash are frozen.
- A failure here cannot be repaired by tuning against this interval.

### Excluded bridge interval

- 2022-09-01 through 2023-07-01
- Excluded from candidate selection and blind validation because portions of this period were previously inspected in other historical research.

### Post-2026-07 evidence

- Not used in Premium candidate design.
- Not automatically Fresh OOS for all purposes because portions of post-2026-07 behavior have already been observed in earlier SOL-specific work.

## Single predeclared architecture

The only permitted first Premium candidate is **Premium Divergence Ownership V17**.

Causal hypothesis:

- sustainable Long ownership is more attractive when price/residual trend is positive while futures Premium is not crowded high relative to its own recent history;
- sustainable Short ownership is more attractive when price/residual trend is negative while futures Premium remains relatively high rather than already deeply discounted;
- this represents a trend aligned with positioning divergence / squeeze potential, not a generic Premium mean-reversion strategy.

Rules fixed before results:

1. Common 168h rolling market-factor residualization across BTC/ETH/BNB/SOL/LINK/AVAX.
2. Tradable pairs: ETH/BNB/SOL/LINK/AVAX; BTC reference only.
3. Long candidate: residual 12h and 48h positive; absolute 24h and 72h positive; recent Premium central tendency at or below that pair's rolling 168h Premium median.
4. Short candidate: residual 12h and 48h negative; absolute 24h and 72h negative; recent Premium central tendency at or above that pair's rolling 168h Premium median.
5. Premium is an **entry ownership condition**, not a fast exit trigger.
6. Entry requires two consecutive 6h observations of the same pair/side candidate.
7. An entered pair/side episode cannot re-enter until its candidate state resets to neutral/opposite.
8. Hold/exit uses slower residual + absolute price ownership, not Premium flicker.
9. Rank may fill a vacant slot only; it cannot replace an active owner.
10. Two fixed slots, 0.625 gross each, total maximum research gross 1.25.
11. No periodic resizing, pair-specific parameters, parameter grid, or gross increase to manufacture returns.
12. Normal execution = 10bps / delay0; Stress = 30bps / delay1.

## Return standard

80% is a failure floor, not a target.

- every 1Y return >= 80%;
- median 1Y return >= 100%;
- 3Y CAGR >= 100%;
- strong candidate: every 1Y >= 100% and 3Y CAGR >= 120%;
- robustness/PF/PF-without-best/DD/Stress gates remain mandatory.

## Anti-overfit stop rule

V17 gets one Design-window run. Its source is then frozen before Blind Prehistory is opened.

- If V17 fails the Design sanity standard, no V18 may be produced by tuning Premium thresholds or rearranging the same Premium rules against 2023-26.
- If V17 passes Design sanity, run Blind Prehistory exactly once.
- If Blind Prehistory fails, freeze the Premium line as unsupported; do not tune to the blind interval.
- Any later research must add genuinely new causal information rather than another same-data architecture iteration.
