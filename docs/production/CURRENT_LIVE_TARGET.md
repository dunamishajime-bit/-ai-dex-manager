# CURRENT LIVE TARGET — Top3 + FET + Q102 DD Governor

**Status:** CURRENT_CANONICAL_PRODUCTION_TARGET
**Date:** 2026-09-20
**Production base:** `b6b62bbadf1abe25d8ef31f5f133515b52a0df1c`

This file is the single current Production activation target. GPT, Work, Codex and deployment procedures must read this file and `docs/production/current-live-target.json` before using any older implementation or backtest contract.

## Current configuration

- V12: maximum 3 positions. Rank1/Rank2 preserve the current V12 logic. Rank3 is a lower-priority 0.10x slot and requires score >= 0.70.
- V12 BTC logic: preserve the existing V12 BTC regime and entry-quality logic. The selected 740.77M backtest case is `r3_score070`; it does **not** add the separate `btc03` Rank3-only distance gate.
- V12 base aggregate gross 1.50x, Dynamic Residual ceiling 2.00x, per-position ceiling 1.00x.
- FET: `FET_BRK48_LONG`, FETUSDT LONG, BRK48, 72h median volume x1.2 minimum, 4h decision grid, 24h hold, 5% hard stop, maximum 1.25x, minimum residual 0.05x. FET is lower priority than Core and is preemptible.
- Q102: Causal V4 / one slot. Portfolio DD <= 0.30% permits entry-time boost up to 3.0x. Above 0.30%, or when governor evidence is stale/missing/malformed, use the base family gross.
- Q102 base family gross: HIGH_VOL 1.661x / MR 1.0x / BRK 2.465x / REV 2.5x / PB 2.5x.
- PENGU/V52: preserve current Production behavior.
- Portfolio: Crypto <= 3.0x / Total <= 3.5x / Shared Crypto Daily Loss 7.5%.
- Venue: Aster 5x Cross remains mandatory.

## Formal backtest acceptance

Source artifact: `docs/research-results/top3-fet-q102gov-integrated-20260920.json`
SHA256: `3E5891E27B76E928BE76405FC6CEDAEA4EB4A42A14E9C2BABECA7E608BC0EA2E`
Selected case: `top3_q102gov030_fet1.25`

| Scenario | Ending asset | PF | Max DD | Trades | Crypto max | Total max | FET max | Conflicts |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| NORMAL | JPY 740,771,278.0140501 | 4.12008119 | -19.88452049% | 1,195 | 3.0x | 3.5x | 1.25x | 0 |
| SEVERE | JPY 65,669,109.00323203 | 3.05645475 | -19.99033133% | 1,036 | 3.0x | 3.0x | 1.25x | 0 |

NORMAL routing: V12 793 / PENGU 66 / Q102 71 / FET 26 / V11 50 / V50 93.
SEVERE routing: V12 793 / PENGU 66 / Q102 71 / FET 29.

## Superseded for current activation

The following remain historical evidence but are **not** the current Production activation acceptance anchor:

- `V12_DYNAMIC_RESIDUAL_LIVE_CONTRACT_20260919`
- Research SHA `27f934424b201e4c63986b9b7db64b89ff69b4bb`
- Old Formal BT NORMAL JPY 270,126,566.3772751 / SEVERE JPY 24,184,641.27364947
- Branch `codex/v12-dynamic-residual-live-20260920-clean`
- SHA `f9b0861816b8a70f6158e98f00893457f83e81bb`

Do not use those old acceptance values to block or authorize the current Top3 + FET + Q102 Governor activation.

## Activation rule

Production may advance only when code and replay match this current contract, all relevant regressions pass, state/protection/reconciliation are verified, one runtime SHA is active, Margin Guard is HEALTHY, Kill Switch is false for a resolved reason, and Aster 5x Cross/read-only checks pass. Never use a synthetic LIVE order merely to prove activation.
