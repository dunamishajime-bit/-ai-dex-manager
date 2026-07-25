# Dis-Dex V96 + Aster-only V11-EQ LIVE handoff

This configuration keeps Crypto V96 on AsterDEX and runs V11-EQ on AsterDEX only.

- V13D is disabled and is not spawned by the combined supervisor.
- Hyperliquid credentials, balance/equity checks, SDK calls, and systemd dependencies are excluded from LIVE preflight.
- Pyth is the primary equity reference and Alpaca IEX is the free validator.
- V11-EQ entry notional is calculated on every decision from measured Aster excess margin.
- Excess margin is `max(0, Aster equity - current V96 managed notional - safety reserve)`.
- The safety reserve is `max(DISDEX_V96_MINIMUM_RESERVE_USD, equity * DISDEX_V96_SAFETY_RESERVE_PCT / 100)`.
- If V96 pending, manual review, bootstrap, or kill-switch state requires margin, V11-EQ new Entry is blocked.
- V11-EQ does not preempt V96. Existing V11-EQ positions are managed with the existing reduce-only close and kill-switch controls.
- Existing V96 migration, pending/UNKNOWN reconciliation, and no-order preflight remain mandatory before switching services.

LIVE is allowed only after CI, regression tests, Aster-only preflight, V96 migration, and the no-order preflight pass.
