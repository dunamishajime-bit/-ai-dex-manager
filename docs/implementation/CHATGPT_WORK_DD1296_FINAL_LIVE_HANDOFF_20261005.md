# ChatGPT Work / Codex LIVE Handoff — DD12.96 Final Target — 2026-10-05

## Objective

Integrate the final validated DD12.96 research target into the **current Production source**, deploy it safely to the Xserver VPS, and complete LIVE verification.

This handoff branch is the research source of truth for the strategy contract and BT ledger. **Do not blindly deploy this research branch as-is if current Production has newer operational/safety changes.** Rebase/cherry-pick the strategy deltas into the current Production line while preserving all newer safety fixes.

## Mandatory source of truth

Read completely before implementation:

1. `docs/implementation/FINAL_PRODUCTION_TARGET_DD1296_20261005.json`
2. `docs/research/results/dd1296-final-20261005/README.md`
3. `docs/research/results/dd1296-final-20261005/final-summary.json`
4. `docs/research/results/dd1296-final-20261005/ledger-manifest.json`

The exact Git commit containing these files must be recorded in the deployment evidence and operator activation artifact.

## Required strategy changes

### PENGU
Keep:
- COMBINED_FILTERED
- Gross 1.0
- existing limited 2% structural re-break
- existing Recovery V8 and existing safety/cooldown behavior
Do not add the rejected broad PENGU 72h <= -4% filter.

### HYPE
Keep validated HYPE75 behavior unchanged.

### Q102
Implement **side-specific family Gross caps**:
- HIGH_VOL LONG = 1.00x
- HIGH_VOL SHORT = 0.60x
- REV LONG = 1.50x
- REV SHORT = 1.25x
- PB LONG = 2.00x
- MR default = 0.75x
- BRK default = 0.75x

The side-specific values must be used by:
- live signal materialization,
- observability/decision snapshots,
- pending/exposure reservation,
- margin/gross planning,
- execution,
- restart/recovery state reconciliation.

There must be no path that still assumes a family-only Gross value when side-specific Gross is required.

Add Q102 FET BRK SHORT exhaustion gate:
- only for family BRK
- only symbol FETUSDT
- only side SHORT
- use entry-time causal data
- if FET 72h return <= -12%, reject the new Q102 BRK SHORT
- rejection must be explicit in the decision snapshot/history, e.g. `Q102_BRK_FET_SHORT_EXHAUSTION`

### FET BRK48 LONG
Require:
- causal FET 72h return >= +2% at entry
- existing volume/breakout conditions remain unchanged
- after **any FET exit**, block new FET entry for 24h
- persist cooldown across restart
- expose cooldown reason/status on the existing decision snapshot / HP feed

Keep existing:
- volume ratio >= 1.2
- 24h hold
- 5% hard stop
- after +5% reached, stop floor +0.5%
- existing leverage/margin/safety constraints

### V12
Keep normal V12 logic/gross unchanged except these validated loss filters.

1. Same-side loss cooldown:
- maintain consecutive realized-loss streak independently for LONG and SHORT
- after 6 consecutive losses in one side, block **only that same side** for 6h
- opposite side must remain eligible
- a realized win in that side resets that side's loss streak
- persist state across restart
- preempted/forced exits must have an explicitly defined treatment and match the BT contract; do not silently alter the counter

2. AVAX Rank1 SHORT rebound gate:
- only AVAXUSDT
- only V12 SHORT
- only Rank1
- entry-time causal 3h returns
- BTC 3h return must be negative
- define `directionalRelative3h = sideSign * (assetReturn3h - btcReturn3h)`, sideSign = -1 for SHORT
- block when `directionalRelative3h <= -0.0075`
- explicit reason in decision evidence

3. ATOM exhaustion gate:
- only ATOMUSDT
- entry-time causal 3h returns
- `directionalRelative3h = sideSign * (assetReturn3h - btcReturn3h)`
- block when `directionalRelative3h >= +0.00603`
- explicit reason

4. AVAX Rank1 LONG weak-momentum gate:
- only AVAXUSDT
- only LONG
- only Rank1
- entry-time causal 24h directional return
- block when directionalReturn24h <= +0.0165
- explicit reason

Critical causal requirement:
- do not reproduce the earlier research off-by-one error.
- the final BT uses the price available at the entry boundary and causal lookbacks from that boundary.
- no current/future H1 close may be used before it is known.

### V52 / IDLE / RESIDUAL
No strategy-rule changes. Preserve current Production behavior and ownership priority.

## Backtest acceptance anchor

The final integrated 10 bps research result is:

- final equity: JPY 4,067,358,397.424793
- PF: 2.960180377096512
- maximum MTM DD: -12.96457052048714%
- closed trades: 1,358
- V12: 995 trades / 643 wins / 352 losses
- ownership conflicts: 0
- accounting: PASS

Do not claim parity if the reproduced result materially differs. Explain any difference before LIVE activation.

## Required tests before deployment

At minimum add/update tests proving:

1. Q102 side-specific Gross:
   - HV LONG 1.00
   - HV SHORT 0.60
   - REV LONG 1.50
   - REV SHORT 1.25
   - PB LONG 2.00
   - MR/BRK 0.75

2. Q102 FET BRK SHORT:
   - -11.99% 72h does not block due to this gate
   - -12.00% or lower blocks
   - non-FET, non-BRK, and LONG are unaffected

3. FET:
   - +1.99% 72h blocks
   - +2.00% passes this gate
   - 24h post-exit cooldown persists across restart
   - entry becomes eligible after cooldown expiry if all other gates pass

4. V12:
   - 6 consecutive SHORT losses -> SHORT blocked 6h, LONG still eligible
   - 6 consecutive LONG losses -> LONG blocked 6h, SHORT still eligible
   - side win resets only that side streak
   - state persists across restart
   - AVAX Rank1 SHORT threshold boundary
   - ATOM exhaustion threshold boundary
   - AVAX Rank1 LONG 24h threshold boundary
   - causal lookback uses no future H1 close

5. Integrated ownership/accounting:
   - no duplicate symbol ownership
   - Q102/V12/FET/PENGU/HYPE/IDLE/RESIDUAL priority remains deterministic
   - accounting reconciliation PASS

6. Existing safety regressions:
   - account lock
   - shared rate-budget lock
   - kill switch
   - pending exposure reservation
   - margin guard
   - minimum order quantity/notional
   - watchdog
   - exact-commit operator activation
   - restart/state migration

## Deployment procedure

1. Inspect current VPS Production SHA, current release, service list, open positions, pending orders and safety state.
2. Preserve all newer Production operational/safety fixes.
3. Implement the strategy contract above on a dedicated Production implementation branch.
4. Run TypeScript/build/tests and all relevant selftests.
5. Re-run/reconcile the integrated BT against the ledger anchor where practicable.
6. Push implementation branch and confirm remote SHA.
7. Prepare immutable release directory for the exact SHA.
8. Before activation:
   - reconcile current positions and ownership;
   - do not flatten valid managed positions merely because of deployment;
   - safely migrate state for V12 side-loss counters and FET cooldown;
   - verify Kill Switch false;
   - verify Margin Guard healthy;
   - verify account/shared locks healthy;
   - verify 5x cross-margin contract where required.
9. Update exact-commit operator activation artifact for the new SHA.
10. Switch current release atomically.
11. Restart/activate all affected runners and support services using the repository's existing safe deployment procedure.
12. Verify runtime SHA equals GitHub remote SHA for every affected service.
13. Verify:
   - V12 active/running
   - PENGU active/running
   - Q102 active/running
   - V52 active/running
   - FET active/running
   - HYPE active/running
   - IDLE/RESIDUAL services as applicable
   - Shared Risk / Margin Guard healthy
   - Kill Switch false
   - no ACCOUNT_LOCK_BUSY loop
   - no stale old-SHA runner active
   - no ownership conflict
   - HP/decision-status reflects the new gates and Gross values
14. Observe at least one full decision cycle and save evidence snapshots.
15. Do not declare success until the exact running SHA, service health, state migration, decision evidence and safety gates are all verified.

## Required final report

Return:
- STATUS
- implementation branch
- implementation SHA
- GitHub remote SHA parity
- previous/rollback SHA
- current release path
- each runner/service status + PID + NRestarts + runtime SHA
- applied Q102 side Gross values
- applied FET gates/cooldown
- applied V12 loss/cause gates
- state migration result
- Kill Switch state
- Margin Guard state
- account/shared lock health
- open positions/orders ownership reconciliation
- HP/decision-status verification
- test/build results
- any deviation from the 10bps BT anchor
- rollback command/procedure
