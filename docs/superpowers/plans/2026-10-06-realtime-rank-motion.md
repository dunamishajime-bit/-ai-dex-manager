# Realtime rank motion repair
Goal: show actual rank swaps in both the top-three cards and the row grid.
Scope: isolated production UI only; no trading logic, scores, gates or polling changes.
Evidence: browser fixture B 2→1 and A 1→2 animates only B's row before repair (1 overlay; expected 4).
- [x] Reproduce against deployed UI with isolated read-only browser response fixtures.
- [x] Register leader cards separately and animate every displaced fresh evaluated visible row/card.
- [x] Verify swaps, stable ranks, motion OFF, reduced motion and cross-column moves in browser; run UI suite/typecheck/build.
- [ ] Push and deploy UI through VPS workflow; verify routes/API and trading SHA/PIDs unchanged.
Animation keeps existing viewport, hidden-tab and reduced-motion protections. New/stale/unscored rows must not invent a movement origin; unchanged ranks do not animate.

Verified: 87/87 UI tests; tsc --noEmit; actual board/hook browser bundle: swap 4 elements, stable/OFF/reduced no motion, reverse swap 4, cross-column 22, filter no false origin, mobile no horizontal overflow. Old deployed UI fails the 4-element regression with only 1 overlay. Windows Next build hit invalid existing SWC binary and timed out under WASM; production build is validated on Linux CI instead.
