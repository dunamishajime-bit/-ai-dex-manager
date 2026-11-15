# BT PR #481 — Frozen native PENGU V2 / Short V20 / Recovery V8 source-only shadow (2026-11-15)

## Scope

This change is offline and READ-ONLY relative to the separately-owned Codex STABLE4 implementation and LIVE systems. It copies the native PENGU pure signal source and frozen configuration into the isolated BT worktree, then evaluates entry decisions against invented PENGU/BTC H1 observations. It does **not** create any simulated PENGU order, position, exit, realized PnL, fees, Gross, cooldown lifecycle, shared risk or Portfolio Opportunity selection.

Upstream source checkout: Git SHA `9118eeaa6c209dc6e37887cf5be139b3baaa005d`, PC `C:\tmp\disdex-stable4-impl-20261114` (read-only reference).

### Exact source pins

| Upstream source | Original Windows SHA256 |
| --- | --- |
| lib/pengu-dual-ls-v2.ts | a72123d76e0c5783553cafa5a452664274d4450e06a5afb17ecf1738b5ad6546 |
| lib/pengu-short-v20.ts | fce39b4ff1c6b5c7e62438e9a974a9479c0ecf5b5a1b41a91a5f2edf78caee65 |
| lib/pengu-recovery-v8.ts | 9ede7042755f594025537d3e7ede365e6c6156f99ebb76aafb6f15d43833790d |
| config/penguDualLsV2Runtime.ts | 4dfd88c27caa430bbbe02c04d70656241cc080fd79118e5c021987cc1786aac2 |
| config/penguRecoveryV8.ts | 053f4578390ce3cd8547669c01142b70517969e837391608948206a672d088d8 |
| config/integratedProductionRiskPolicy.ts | 634ee196b267e3ec55e195f1fec9527669157926b191e473ab0aa1adb042c633 |
| config/sharedCryptoRiskPolicy.ts | a83611274a909616031c9c94faa25e44fa1d07436e09c044d2053aa88f6a7494 |
| config/q102FamilySideGross.json | 61901ee765b8ce5202ebbdc16561c806f78acc16a157b1197e0f92ee3e9c3450 |
| config/v52V50Runtime.json | 16c24ec472df9141bbde60b993120fb0a9b9bc3739a0bb8251c6371119e3390c |

BT copies are under `lib/bt-verification/pinned-native-pengu/`. No native algorithm, numeric thresholds, state-machine, policy values or source candidate family was changed. Only 11 runtime/type-only import path references are rewritten to neighboring frozen copies or type-only stop protection declarations. `pengu-protection-types.ts` snapshots the original source interfaces without copying any venue STOP creation or order execution function. Source hash selftest restores those imports and platform CRLF for exact upstream SHA256.

## Causal artificial-market path

- Generate deterministic 5-minute OHLCV, then use **only fully closed 1H candles** to call the original pure `buildPenguDualLsV2Signal`. Both BTCUSDT and PENGUUSDT history must be contiguous, valid, with 12 observed five-minute ticks per H1 and end <= decision timestamp. Original Aster-style `closeTime` is mapped to `closedAt - 1 millisecond` to maintain native strict past-bar filter.
- Entire available causal H1 history is supplied, up to 6,000 observations. Do not truncate to rolling 168 or 320 H1 because reinitializing EMA from an artificial later start would change the original native source signal.
- The original native source runs with options `recoveryV8Enabled: true`, `v64DynamicLongEnabled: true`, position absent and cooldownUntil=0. This is **entry candidate shadow**, NOT the actual lifecycle/sleeve priority and not a live signal equivalence certification.
- The historical STABLE4 research ShortV20/RecoveryV8 pretarget regime filters remain separate, each labeled `RESEARCH_PRETARGET_ONLY`; native source candidates and pretarget gates are not silently fused into a false executable trade.
- Ten-day H48-only synthetic study adds one `PINNED_NATIVE_PENGU_ENTRY_SHADOW` risk event at every completed H1: original source accepted/rejected, direction, entry lineage, requested target Gross and source SHA snapshot. Every event explicitly ends `NO_FILL NO_RISK_ADMISSION`; only H48 creates simulated positions in this mode.

## Tests

- `scripts/bt-hp-pengu-native-full-source-selftest.ts` restores original upstream 9 module hashes, checks engineered native Long/Short first-priority decisions, exact Recovery V8 3% bounce + RSI/EMA/BTC thresholds, rejects invalid historical/future/gapped data, and samples 17 days of synthetic OHLCV.
- Synthetic v3 `seed=20261115`, `rotation`, 2025-10-01 through 2025-10-18: 408 closed H1; 179 insufficient warmup; 229 true source evaluations; 4 native Long candidates, 1 Short candidate, of which 2 were Recovery V8 entries (subset of Long); 0 invalid input, 0 orders, 0 PnL.
- `scripts/bt-hp-multiasset-h48-replay-selftest.ts` confirms 240 PENGU native shadow risk records in ten-day research replay, with H48 equity/fees/gross reconciliation unchanged. Existing FET/IDLE/Q102 source and owner-only server job regression tests remain valid.
- `npm run typecheck` and `npm run build` PASS in isolated BT worktree.

## Remaining gaps

PENGU actual position open, V20 probation timed exits, Recovery V8 partial/hard/trailing STOP and operator protection, native sizing/cooldown/priority/short-first lifecycle, real funding and Shared Risk/Gross are not connected. Other six runners, Q102 Online Layer 2/3, cross-strategy capital opportunity selection, full 6-month integrated replay, authenticated UI E2E and production HP deployment are still outstanding.

Most importantly: **the 13.54m JPY historical STABLE4_OPPORTUNITY research BT is not reproduced from synthetic prices by this feature.** Candidate-only results are not trades and cannot be used to infer profit or win-rate. LIVE/Codex worktree remains unchanged.
