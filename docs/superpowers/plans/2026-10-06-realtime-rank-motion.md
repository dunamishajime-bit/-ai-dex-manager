# Realtime rank motion repair
Goal: show actual rank swaps in both the top-three cards and the row grid.
Scope: isolated production UI only; no trading logic, scores, gates or polling changes.
Evidence: browser fixture B 2→1 and A 1→2 animates only B's row before repair (1 overlay; expected 4).
- [x] Reproduce against deployed UI with isolated read-only browser response fixtures.
- [x] Register leader cards separately and animate every displaced fresh evaluated visible row/card.
- [x] Verify swaps, stable ranks, motion OFF, reduced motion and cross-column moves in browser; run UI suite/typecheck/build.
- [x] Push and deploy UI through VPS workflow; verify routes/API and trading SHA/PIDs unchanged.
Animation keeps existing viewport, hidden-tab and reduced-motion protections. New/stale/unscored rows must not invent a movement origin; unchanged ranks do not animate.

Verified: 87/87 UI tests; tsc --noEmit; actual board/hook browser bundle: swap 4 elements, stable/OFF/reduced no motion, reverse swap 4, cross-column 22, filter no false origin, mobile no horizontal overflow. Old deployed UI fails the 4-element regression with only 1 overlay. Windows Next build hit invalid existing SWC binary and timed out under WASM; production build is validated on Linux CI instead.

Production run 37445706915 SUCCESS; UI SHA eef82fba25f84a6577ae2e74995fdc0689159d83. The full browser regression passed against the deployed page. Postdeploy actual API: 49 rank routes, 19 Q102 diagnostics, score-100 invariant, synchronized lineage, Idle HEALTHY. Trading SHA 8ed7c2266af33758b0a0f301aefc2457a7a7eab6 and all 9 service PIDs/restart counters unchanged. See docs/production/realtime-rank-motion-20261006-evidence.json. Ranking response fixtures affect only the isolated browser test, not live data or orders.

User clarified foreground choreography at 18:58 JST: rising currencies visibly enlarge, lift toward the viewer, pass over other currencies, then land in the correct rank. Updated flight has six keyframes: origin, 1.8x foreground lift, hold, foreground travel, descent, 1x landing; duration 2400ms. Downward movers remain at 1x for 1800ms. Foreground bounds clamp to the viewport; reduced-motion/OFF/stable-rank protections remain. The new prominence regression failed against the preceding deployed version and passed against the real component bundle. 87/87 UI tests and typecheck passed.
