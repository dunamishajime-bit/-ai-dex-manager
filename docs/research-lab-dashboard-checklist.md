# Research Lab Dashboard Verification Checklist

- [ ] `npm run typecheck` succeeds.
- [ ] `npm run build` succeeds under Node 22.
- [ ] `/api/research-lab/latest` returns JSON from `research-autonomous-state`.
- [ ] `/research-lab` renders the latest cycle without browser console errors.
- [ ] The page remains usable on a mobile-width viewport.
- [ ] Manual refresh and 60-second refresh both work.
- [ ] Temporary GitHub fetch failure preserves the previous payload as stale.
- [ ] No AsterDEX, wallet or real-order capability is introduced.
