# Canonical causal-gate A/B — 2026-11-11

Locked canonical current-implementation baseline; research only.

## Results

### IDLE_JUP_ROBUST
- 10bps: Final JPY 277394.04; DD -53.84%; fills 439; Win 57.18%; PF 1.236
- 30bps: Final JPY 93123.88; DD -60.85%; fills 418; Win 54.55%; PF 1.158

### CAUSAL_THREE
- 10bps: Final JPY 425519.69; DD -42.42%; fills 436; Win 58.94%; PF 1.404
- 30bps: Final JPY 206185.01; DD -45.46%; fills 430; Win 56.98%; PF 1.324

## Determinism

- Pass1 vs Pass2: **42/42 artifacts SHA256 exact match** (21 x 2 cases).

## Interpretation

- CAUSAL_THREE keeps the same DD as the earlier rel24-only THREE while using the causally robust two-feature IDLE rule.
- It gives slightly lower final equity because it removes more IDLE JUP candidates.
- This is stronger causal support, but still research-only; PENGU forward n=4 and Q102/FET forward evidence remains small.

