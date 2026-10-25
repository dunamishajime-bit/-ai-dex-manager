# RENDER dual-route pre-LIVE audit — 2026-10-25

Status: STAGED_RESEARCH_REQUIRES_FURTHER_EXECUTION_AND_ECONOMIC_CERTIFICATION.
This document must not be used as a LIVE-activation certificate.

## SHA lineage and preservation

- V4 in-use runtime at the start: 23ddd4b01fcff38cd10d4d4614221f93dc6b44e5.
- Other in-use runners / IDLE: 7688ed7c93a1918d8b44837339b7da5584a868f5.
- Source handoff: 1beb778eb59639afa951e2c5e2bf5fb84dabb6b9.
- Research integration starts from 23ddd4b0, which is 13 commits ahead of 7688ed7c.
- Existing VPS release symlinks and active systemd units were not changed.

## Newly staged in isolated worktree (not in Production)

- Original RENDER-only initial adverse monitor: -1% confirmed M5 close, monitor 120 min,
  still at/below -1%, entry-to-date MFE strictly < +0.25%. State is persisted
  alongside owned existing IDLE position, only when explicitly gated with DISDEX_RENDER_LEGACY_ADVERSE_LIVE_CERTIFIED after signed venue/first-M5 certification. Default false. Market source gaps do not create exits.
  The existing venue owner/reduce-only position-close path is reused.
- Standalone six-hour RENDER virtual-shadow journal with atomic writes,
  SHA validation, replay-duplicate prevention, forward-only H1 decisions,
  settled-before-decision historical scores and no live trading capability.
- Verified complete 72h M5 public venue data loader using BTC OHLC and
  RENDER OHLC/baseVolume/takerBuyBaseVolume, with no OI requirement on
  the new independent Gate.
- A Shadow diagnostic path is added to the existing IDLE runner, executed
  only on a new H1 and isolated from normal IDLE entry approvals.
- Route-specific 55-minute/2%/1.5% protected LIVE execution is **NOT**
  implemented or connected to real venue. The legacy runner's 12/24-hour
  architecture must not be misrepresented as a 55-minute independent route.
  DISDEX_RENDER_INDEPENDENT_LIVE_CERTIFIED defaults to false and is not
  itself sufficient to authorize any order.

## Proven isolated checks (not economic or real-venue certification)

- Node v24.13.1, TypeScript project typecheck PASS.
- Existing IDLE regression 64 tests plus four new journal tests PASS.
- Pure RENDER high-WR/legacy-stop suite 21 tests PASS.
- Additional two IDLE state tests PASSED.
- Runner-side stop timing depends on the first usable fully closed M5 after
  protection installation. An authenticated fill timestamp / trade history
  parity still needs certification; no guessed intrabar MFE is allowed.

## Blocking requirements before any cutover

1. Integrate the independent route into native owner selection with causal
   incumbent scores, no same-symbol double exposure, 12h cooldown and shared
   account/margin/rate/safety locks. Do not bypass existing superior TAO/TIA
   trades or allow the new route to preempt an unscored incumbent.
2. Add route-distinct 55-minute protected resident STOP/TP at -2%/+1.5%,
   0.25x requested gross, exchange precision validation and reduce-only
   readback. Exercise partial fills, unknown submissions, STOP/TP races,
   hard timer, unexpected restart and rollback.
3. Verify actual signed execution timestamp and historical M5 consistency
   before authorizing the newly wired legacy adverse stop on real positions.
4. Recreate the complete latest Task9 eight-logic dynamic integrated economic
   backtest for BOTH changes simultaneously, 10bps and 30bps,
   including displaced winning legacy trades, gross/capital competition,
   downside and DD, count/PF and profit. Individual research improvements
   are **not** an integrated result and must not be summed.
5. Run Forward Shadow on VPS with real public candle and exchange readback
   evidence; minimum lifetime 24 settled six-hour virtual trades, WR>=75%,
   PF>=1.35, mean net>=0.10% and recent-365-day min 3/WR>=60%/mean>=0%;
   historical data as-of decision only.
6. Produce a signed release-bound operator certificate and read-only
   positions/orders/protective-order verification, then request explicit
   operator final activation. Merely starting systemd does not prove
   orders are permitted.
7. Verify V4 remains bound to its distinct 23ddd4b0 lineage, then derive
   a **single merged candidate SHA** and rollback for all runners.

Unmet blocking conditions MUST keep the new independent RENDER route
in Shadow-only mode. Legacy stop must also retain default-off gating until fill/MFE proof. Do not report FULLY_VERIFIED_LIVE.

## Verified historical material locator (not a completed combined BT)

Local Windows model research can be found under C:/tmp/render-mtf-study-20261024 and C:/tmp/render-multiregime-study-20261024/scripts/dd-reduction.
- run-idle-render-after-pengu-full8-20261024.py contains the approved original stop research case RENDER_TOUCH1_WATCH2_MFE0P25 using screen-idle-next-m5-after-pengu-20261024.py with cumulative PENGU/AVAX eight-wallet baseline.
- run-render-4427-independent-profit-sell55-native8-20261024.py models an older six-hour independent Gate but does not reproduce the new 55-minute live exit; do not reuse those results as the combined 55m answer.
- RENDER_4427_INDEPENDENT_SELL55_NATIVE8_AUDIT_20261024.json includes economic Native8 ledgers for other separate cases; data already viewed and potentially overfit.
- Historical Aster 2025 H1 mark gaps and real funding/venue limits must be represented explicitly. Demand source provenance and certify all eight sleeves at current model SHA.
