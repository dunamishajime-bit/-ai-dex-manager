# Canonical causal-gate A/B on V52-capital-corrected baseline — 2026-11-11

Baseline commit: `38774e171a3523a404464a7e9bc6f38fc46d8ee8`

| Case | 10bps Final | 10bps DD | 10bps Win | 10bps PF | 30bps Final | 30bps DD | 30bps Win | 30bps PF |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| IDLE_JUP_ROBUST | JPY 890,372.29 | -51.89% | 57.60% | 1.267 | JPY 329,670.08 | -58.77% | 56.27% | 1.198 |
| CAUSAL_THREE | JPY 1,585,699.80 | -41.35% | 59.63% | 1.431 | JPY 579,086.35 | -50.60% | 58.26% | 1.322 |

Determinism: **42/42 artifacts SHA256 exact match**.

CAUSAL_THREE removes 276 source intents: IDLE JUP robust two-feature gate 235, PENGU V8 BTC24 gate 16, Q102 FET ret14 gate 25.

Research-only. No Production mutation.
