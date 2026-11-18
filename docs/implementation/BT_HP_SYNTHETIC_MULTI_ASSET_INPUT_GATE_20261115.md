# BT #481: causal multi-asset synthetic inputs and native gating — 2026-11-15

Scope: branch `feat/bt-visual-gross-20261114`, read-only offline model and BT user interface only. Do not merge into or operate Codex LIVE runner, order, STOP, systemd, approvals or production.

## What was implemented

- `lib/bt-verification/synthetic-market.ts`: 5-minute causal streaming synthetic candles for **15 crypto tickers and 8 US stocks**; for each generated tick it exposes observed symbol quotes (bid, ask, volume and tradability), completed 5-minute and hourly OHLCV, a synthetic USDJPY mark and artificial 8-hour crypto funding events.
- Separate seeded market paths for trend/range/down/volatile/rotation, common factors and symbol-specific shocks. Reproducible by seed + scenario + UTC window. No external network, exchange or production dependencies.
- Market closes of the current H1 are emitted only at the hour close; history copies have no future bars. NY weekday regular trading hours gate the stock symbols, **without** holiday calendars, corporate actions or after-hours prices. H1 partial stock sessions retain an explicit partialSession flag; no spurious 12-bar completion is claimed.
- Six-month period 2025-10-01T00:00:00Z to 2026-04-01T00:00:00Z is processed incrementally; 5-minute frames are not retained indefinitely.
- `lib/bt-verification/synthetic-feed-audit.ts` and the BT conditions screen: the user can run an on-device 7-day **input coverage** check and view stats and blockers. No native strategy profitability or combined BT is calculated by this audit.
- The seven strategy families V4/Q102/PENGU/FET/IDLE/V52/HYPE remain **native-decision-not-connected**. This is a deliberate fail-closed contract rather than passing synthetic proxy decisions off as production.

## Tests and evidence

- `scripts/bt-hp-synthetic-market-selftest.ts`: deterministic seed replay, bid/ask/candle sanity, no future closed bars, no future funding, immutable H1 history, stock closed-session absence, invalid input rejection and six-month stream.
- Six-month synthetic stream audit: 52,416 5-minute ticks, 4,368 closed BTC H1 candles, 8,190 synthetic funding records, 81,120 stock tradable tick observations, 1,040 partial-session H1 stock bars. Stock holidays and split data were deliberately **not** modeled.
- `scripts/bt-hp-synthetic-feed-audit-selftest.ts`: 168 hours and 2,016 ticks, 23 instruments, 315 funding records, input validation, deterministic independent audit and strict blocker display.
- TypeScript check and Next.js production build PASS; no tests place real exchange orders.

## Frozen source comparison to preserve

- Owner PC archive: `DIRECTION_RESEARCH_20261109/STABLE3_REPRO_RECOVERED_20261113/portfolio_stable4_hype6_q102_dualhealth_validation_20261114.py` SHA256 `e58b735a528f369d1017fd2469efdf7873c48fcfd92dde4727af40fa8a5d1d4c`. Research-only, historical candidate tape, not production implementation parity.
- Separate local STABLE4 implementation branch (which may change under Codex): `config/disdexStable4Opportunity.ts` snapshot SHA256 `cd090adbad8ecbaa652d6889897072ea6193587cb123da4b31a770e9a2d69846`. At snapshot source it had HYPE emergencyStopPct 0.05 and emergencyTakeProfitPct 1.0, versus candidate source's historical H48 hardStop 0.06.
- H48 candidate study 27 target rows: 21 time exits, 6 stops; its 27 entry timestamps are on a six-hour UTC grid. Integrated STABLE4 historical results admit only 8 HYPE model exits (7 time and 1 formal priority).
- These distinct stop criteria, priority preemption and sourced online inputs **must not be treated as one certified engine**. The existing H48 standalone synthetic sampler uses candidate 6% and is not the native multi-runner engine.

## Outstanding native integration gates

1. Bring complete, immutable, authorized production/research signal module pins for all 7 runner families into an **isolated** research executor; do not reuse the LIVE process or mutate operational state.
2. Validate inputs required by each underlying native signal (including interval alignment, M5/H1 history, venue calendars, quantities, routes, online seeds / prior realized exits, source-specific volume and funding); never backfill missing requirements with neutral values.
3. Execute Layer 1/2/3, position admission, V4/formal preemption, native STOP/TP/partial/funding, shared daily loss limit and gross 3.0/1.5/3.5 on that *same* observation stream; reconcile decisions, fills and model equity as of each tick.
4. For the browser, stream / downsample from isolated BT worker with a six-month state ledger and signed source hashes; don't calculate 6 months of all native engines in the UI main thread.
5. Complete browser E2E, credentials-protected server library, staging and approved production HP deployment only after all upstream validation gates pass.
