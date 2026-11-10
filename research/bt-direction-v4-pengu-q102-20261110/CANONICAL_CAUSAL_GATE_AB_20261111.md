# Canonical causal-gate A/B — 2026-11-11 post V52 strategy-capital fix

Research only. Rules have saved train/validation/forward support and are replayed on the corrected canonical baseline.

## Frozen causal rules

- IDLE JUP robust: rel24 >= -0.04089204262472046 AND volumeRatio >= 1.2568362211142174.
- PENGU V8: btc24h <= 0.011611625094354983.
- Q102 FET: ret14 <= 0.048722800378429465.

## Results

- Baseline 10bps: Final JPY 887,336.06; DD -56.31%; fills 537; Win 57.36%; PF 1.222.
- Baseline 30bps: Final JPY 321,161.96; DD -63.20%; fills 537; Win 56.24%; PF 1.168.

### IDLE_JUP_ROBUST
- 10bps: Final JPY 890,372.29; DD -51.89%; fills 526; Win 57.60%; PF 1.267.
- 30bps: Final JPY 329,670.08; DD -58.77%; fills 526; Win 56.27%; PF 1.198.

### CAUSAL_THREE
- 10bps: Final JPY 1,585,699.80; DD -41.35%; fills 540; Win 59.63%; PF 1.431.
- 30bps: Final JPY 579,086.35; DD -50.60%; fills 539; Win 58.26%; PF 1.322.

## Determinism

- Pass1 vs Pass2: 42/42 artifacts SHA256 exact match across the two causal cases.

## Current interpretation

- CAUSAL_THREE materially improves final equity and DD versus corrected canonical baseline.
- It still does not reach the target zone near 70% win rate / <=20% DD.
- PENGU forward evidence is small (n=4) and Q102/FET forward evidence remains modest, so research-only.
- V4 current-policy replay is implementation parity, not unbiased OOS evidence. V52 V50 remains a price proxy and V11 remains fail-closed omitted.

