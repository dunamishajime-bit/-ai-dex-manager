# Rejected Score/GROSS allocation cleanup; VPS/BT parity audit (2026-10-25)

## Scope

Owner rejected both Score-ranked extra GROSS distribution and experimental residual-capital smaller orders. Preserve native strategy entry, exit, priority, per-strategy native lot approval, shared risk, hard GROSS, margin, kill switch, protected STOP, account lock and recovery.

## VPS direct read-only inspection

The Windows Git SSH authorized connection succeeded. The active V12-V4 service runs release SHA 23ddd4b01fcff38cd10d4d4614221f93dc6b44e5. PENGU, Q102, FET, HYPE, IDLE and V52 plus shared risk and margin guard run release SHA 7688ed7c93a1918d8b44837339b7da5584a868f5. The common current symlink resolves to the latter SHA. Services were reported active.

Both active releases were checked with direct file-existence and source-reference inspection. NONE contain the three rejected research-only modules:
- lib/disdex-dynamic-entry-allocation.ts
- lib/disdex-overlap-residual-allocation.ts
- lib/disdex-dynamic-entry-intent-registry.ts

Therefore the rejected Score allocation was NOT deployed into the actual trading releases. Do not restart or redeploy just to remove an absent module.

## Research Git branch removal

Delete the two allocation algorithm files and their exclusive tests. Keep only candidate data-type definitions in lib/disdex-entry-intent-types.ts, preserve strict order approval/reservation/recovery safety. The optional BT performance bonus is no longer used to influence strict entry. Native approved lot is never recalculated downward in reservation: reject unavailable approved quantity rather than quietly invent a smaller order. Preserve historical research reports for audit; do not mistake them for deployable code.

Focused regression 26 PASS / 26; production TypeScript check PASS; research TypeScript check PASS; whitespace check PASS.

## Direct VPS release code SHA256 vs archived 2026-10-23 eight-strategy backtest source

Result: NOT SOURCE IDENTICAL.

VPS has Pengu timed SHORT STOP source, AVAX residual policy and FET trailing STOP source absent from archived BT research tree. Moreover, archived-vs-active code differs for Pengu dual LS entry/portfolio runner, FET live runner/runtime, IDLE priority runner, Q102 daemon runner, V52 Aster-only engine, V12 V4 runner engine/entry script, and IDLE residual policy. Among inspected files, integratedProductionRiskPolicy.ts was byte-identical; that alone does not establish integrated strategy identity.

The 10/23 historical full-eight native BT (10bps initial JPY10k, JPY247.44m final) and subsequent retrospective native rescue comparisons are comparable inside that archived research-source cohort, but NOT certified as an exact LIVE SHAs matching economic BT. A current backtest needs source-locked V12 V4 independent SHA 23ddd4b0 plus common seven-Runner SHA 7688ed7c, current signals/exits/owner/risk/STOP and original data/granularity, then independent re-run entry/exits/account funding and wallet across 10bps/30bps.

Historical Git branches may still contain rejected code; origin/master and both currently active VPS release directories do not. Do not deploy an old experimental branch without verifying cancellation. No LIVE changes, cancellations, orders, service restarts, kill switch or risk edits were performed.

STATUS: SCORE_GROSS_EXPERIMENT_REMOVED_FROM_RESEARCH_CURRENT_BRANCH; LIVE_NEVER_HAD_THIS_MODULE; LATEST_BTPS_VPS_NOT_PARITY.
