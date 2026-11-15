# Codex deployment handoff — both RENDER SHORT routes (2026-10-26)

STATUS: RESEARCH_STAGED_NOT_LIVE. No claims of real Aster order certification.

## Verified source and runtime

Repo: dunamishajime-bit/-ai-dex-manager
Research branch: research/render-dual-production-prep-20261025
Starting candidate SHA: e0da3ef7e5fc47273c0ca1cfc5d04aacc112b4de. Codex MUST re-read remote HEAD and review any newer changes.
VPS shared Production current: 7688ed7c93a1918d8b44837339b7da5584a868f5.
VPS V4 runner SHA: 23ddd4b01fcff38cd10d4d4614221f93dc6b44e5.
Both live SHA values are ancestors of this research candidate, NOT proof of parity to actual L2 venue/order runtime.
Local tests: TypeScript typecheck PASS; 95 selected relevant Idle/Render regression tests PASS. Source code is staged; VPS and live new orders have not been altered.
GitHub API returned no combined commit statuses and no PR workflow runs. Exact-SHA CI remains UNPROVEN.

## Immutable route contracts

Legacy SHORT, IDLE_RENDER_RELATIVE_SHORT:
- Preserve original entry, gross 0.25x, max hold 12h, resident STOP -10%, TP +25%, currently approved trailing exit unchanged.
- Additional initial negative-excursion exit: first fully CLOSED 5m bar at PnL <= -1% starts 120 minute watch. Once >=120m, if latest closed bar still <=-1% and historical maximum favorable excursion is strictly below +0.25%, use original protected reduce-only exit. Do NOT close immediately at -1%.
- Persistent 5m watch state must survive restarts and unknown/partial fills. Do not reconstruct pre-upgrade MFE or infer signed fill timestamps.
- LIVE activation flag remains FALSE by default and requires a root-owned SHA-bound, separately verified legacy certificate.

Independent SHORT, IDLE_RENDER_INDEPENDENT_HIGHWR_WICK_SHARP_S6_SHORT:
- Completely separate OI-FREE signal, no minimum Shadow sample/WR/PF historical entry gate. Six-hour hypothetical Shadow is diagnostic-only.
- Prior fully closed H1 BTC >=+0.15%, RENDER H1 <=-0.50%; last fully completed H4 RENDER <=-0.15%; H1 taker-sell ratio >=53%; upper wick >=0.35% of H1 opening price.
- MAX Gross 0.75x account equity notional, venue leverage 5x CROSS. Gross is NOT multiplied by five; initial margin around 0.15x account equity at 0.75 gross, before safety buffers.
- If authenticated shared crypto/total wallet capacity allows 0.25–0.75x, size to that exact available Gross with one-step venue quantity floor, otherwise reject. Never bypass shared risk, margin, kill switch, pending exposure, owned positions or order precision.
- TP +2.5%, STOP -2%, maximum real hold SIX HOURS, entry cooldown 12h, exchange-native reduce-only STOP/TP and deterministic dedicated IDs, partial-fill/STOP race and restart reconciliation. The original legacy TP/STOP does not apply.
- NOT the unconditional top-priority signal. Never force-close a protected V12/Q102/other incumbent; keep legacy RENDER and existing core owner priority, same-symbol exclusivity and capital/risk gates.
- The original Idle baseline/Core flat admission restriction remains authoritative until separately re-researched and certified. Eleven historical raw entries DO NOT imply eleven live fills.
- Independent live flag defaults FALSE; SHA-bound root-owned independent certificate requires authentic actual venue lifecycle and integrated cost economics proof.

## Economic handoff, do not misrepresent

Period: 2025-08-10 to 2026-08-10.
Historical market-Gate-only independent: 11 signals; price-model TP2.5, STOP2, 6h resulted in 10/11 winners, PF9.25 (10bps), PF7.58 (30bps). Not real fills, not untouched out-of-sample.
Legacy stop plus unconstrained portfolio owner model, Gross up to0.75x: JPY281,254,554 (10bps), JPY169,494,414 (30bps), DD -14.515/-15.015%; three accepted independent trades. Unconditional priority is REJECTED because it reduced wallet by JPY104,247 (10bps) and JPY1,558,634 (30bps) while taking more RENDER entries.
More production-realistic FLAT-CORE prefilter only accepts ONE independent: JPY281,029,648 (10bps), JPY169,522,781 (30bps), same DD; three repeats accounting PASS. This is the prudent historical comparison, not an authenticated Production economic proof.
Need the SAME eight sleeves shared-wallet BT (V12, PENGU, Q102, IDLE, RESIDUAL, V52, HYPE, FET), both changes concurrently, with correct owner/gross/margin/pending exposure and complete 10/30bps actual source parity.

## Work Codex must finish before the final live switch

1. Verify latest current VPS Production/V4/all eight runner source SHA, active positions/orders, pending exposure, shared risk, margin/kill/lock/rate limits, state migration and release/rollback. Review branch changes against BOTH live parents; no cherry-pick of obsolete runtime files.
2. Reproduce and close remaining source gaps: exact signed fill time / first closed M5 / MFE including partial fill, resident STOP+TP readback with precision, restart, cancel/replace and 6h time-close races, and capacity-limited exact Gross 0.25 to 0.75. Check source code does not accidentally use old 1x venue-step floor. Add tests if necessary.
3. Run exact candidate SHA GitHub Actions or equivalent authenticated CI, repeat integrated eight-sleeve 10bps and 30bps with source hashes, current wallet Gross/margin/funding model and actual core owner priority; report trades, DD, PF, win rate, 1-vs-3 owner model divergence, and per-symbol conflicts honestly.
4. Obtain verifiable signed read-only Aster positions/open orders, 5x CROSS, resident STOP/TP price and quantities and any current protection gaps. True partial-fill, real order, restart and time exit lifecycle certification cannot be fabricated from read-only snapshots. If a bounded real-money canary is needed, obtain explicit scoped operator approval; do not submit unapproved orders.
5. Prepare immutable stage release, exact rollback and both root-owned SHA-bound certificates only after TRUE evidence. Leave route flags OFF, make no changes to existing live orders while any evidence is missing. Run shadow/current-venue preflight and peer runners/watchdog/41 V4 routes.
6. Update HP 判定状況: separate legacy adverse watch/exit and independent RENDER signal/Gross/5x/6h/TP/STOP/owner veto, never mix with legacy route. Verify existing HP pages and telemetry against authoritative VPS state.
7. Only after all evidence PASS and operator explicitly approves: atomically promote exact SHA, enable the two permits, reconcile resident protection and all runners, observe no unowned/surprise orders, verify HP and rollback. Do NOT relax fail-closed, kill switch, shared risk or current core position lock.
8. If any blocker remains, stop with an EXACT BLOCKED reason and list what proof/authorization is missing. Do not claim cutover complete or certificates issued.

## Required report

Exact before/after Production/V4/merged SHA, stage/rollback, CI URLs and tests; signed account/position/order/protection findings; 10bps and 30bps complete integrated BT; both route contracts and operator certs; peer runner/PID/health/pending/lock/margin/rate/disk; HP details and LIVE order eligibility.

Useful sources:
- docs/implementation/RENDER_DUAL_PRELIVE_CODEX_FINAL_HANDOFF_20261026.md
- docs/implementation/RENDER_DUAL_LIVE_PREP_STATUS_20261026.json
- docs/research/results/render-dual-20261026/RENDER_CORE_FLAT_PARITY_NATIVE8_20261026.json
- docs/research/results/render-dual-20261026/RENDER_GROSS075_TP25_H6_PRIORITY_NATIVE8_COMPARISON_20261026.json
- lib/idle-quantity-feasibility.ts, lib/idle-priority-short-runner.ts, lib/render-independent-execution-contract.ts, lib/render-legacy-adverse-cert.ts.

The assistant has staged research/source/tests, not issued venue approval and not made current LIVE changes. The intended Codex task is to close exactly the remaining validated gates, then do the operator-authorized final switch.
