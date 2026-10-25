# RENDER dual-route Production handoff: existing initial-adverse and OI-free independent SHORT
Date: 2026-10-26. Repository: dunamishajime-bit/-ai-dex-manager.
**STATE: CODE_STAGED_RESEARCH_NOT_VENUE_CERTIFIED; Production, orders and VPS not modified.**

## Scope locked by operator

Legacy RENDER / IDLE_RENDER_RELATIVE_SHORT:
- Preserve original entry, 0.25x route, 12h hold, existing resident STOP -10% / TP +25% and existing approved trailing profit protection.
- Add first-adverse close rule: the first *completed M5* close with loss <= -1% starts 120-minute watch. After >=120m, if loss remains <=-1% and lifetime maximum favorable excursion < +0.25%, trigger the existing protected reduce-only exit.
- Recover state after restart; rearm if recovered at check; never confuse the independent route with legacy.
- No reconstructed/pre-upgrade MFE, stale venue mark, ambiguous signed fill time or incomplete first M5 may be called certified. Keep early-stop flag OFF pending proof.

Independent RENDER / IDLE_RENDER_INDEPENDENT_HIGHWR_WICK_SHARP_S6_SHORT:
- Causal H1 BTC >=+0.15%, RENDER <=-0.5%; last **fully completed** H4 RENDER <=-0.15%; H1 taker seller >=53%; upper wick >=0.35% of H1 OPEN. No OI, no generic/legacy RENDER entry condition.
- Historical 6h Shadow WINRATE/PF/N>=24 Gate removed. Journal may remain diagnostic only. No future/forming bar consumption.
- Desired LIVE entry Gross = MAX 0.75x account equity notional, venue 5x CROSS (margin about 0.15x equity at max). TP = +2.5% SHORT price return; STOP = -2% price return; maximum hold 6 hours; independently 12h entry cooldown.
- Do NOT make this independent route highest priority. Respect the existing high-score and same-symbol incumbent; no force-close existing core positions. 0.75x notional is NOT 0.75x * 5.
- Retain resident exchange stop/TP with real venue readback, partial-fill protection, idempotent order IDs and exit ownership/restart recovery. Keep shared gross/crypto caps, margin, pending registry, shared loss and kill-switch unchanged.
- Independent runtime authorizing flag defaults FALSE, and an independently SHA-bound root-owned certificate requires real venue lifecycle and 10bps/30bps combined economics proof.

## Work already implemented on isolated research worktree

- Pure route and separate protective order IDs, normalized STOP2/TP2.5, conservative 6h deadline, expiry-aligned polling.
- Independent route gross .75 vs original legacy .25 differentiated in live admission and order quantity, pending state, dynamic multi-signal requested gross calculation; state validates six-hour hold and route-specific brackets.
- No-Shadow-quality evaluation and journal decision are wired; historical shadow remains diagnostic. Unproven incumbent score prevents replacing incumbent. No absolute priority insertion.
- Legacy initial adverse M5 watch uses durable state and protected reduce-only exit, with new root-owned SHA-bound certificate precheck; independent has its own signed certificate and no implicit enablement.
- Tests of route-bracket, gross, risk veto, same-symbol incumbent, two certificates, restart state and standalone RENDER helpers. LF enforcement.
- Research Native8 combined portfolio 10/30bps documents and scripts and full ledger SHA manifests. Current best *non-absolute priority* 0.75x Gross and TP2.5/6h achieved 10bps final JPY 281,254,554 / 30bps JPY 169,494,414, max DD 14.515/15.015%, 3 independent accepted trades each. Absolute new-signal priority loses 104,247 JPY at 10bps and 1,558,634 JPY at 30bps, and is rejected. Model is NOT same as authentic current VPS / L2 venue.

## Mandatory checks that cannot be fabricated before final LIVE authorization

1. PRODUCTION SHA AND 8-STRATEGY PARITY: current VPS symlink reference at prior read-only check was 7688ed7c...; V4 unit at 23ddd4b.... Re-read both live; merge only if the candidate SHA contains the actual latest source and all eight runner configs. Do not treat sanitized main branch f71a7424 as current Production implementation. Reconcile all state migration and release paths, current risk lock/margin/kill/cap/funding parity and existing positions/open orders.
2. SIGNED VENUE: show signed read-only Aster account/position, 5x cross, stop/TP readback, quantity step/min notionals, partial fills, reduce-only cancel/replace, resident stop after restart, and fixed 6h expiry order. If venue does not provide proof, remain fail-closed; do not forge certificate booleans.
3. LEGACY FILL/MFE: prove first closed M5 and *actual fill timestamp*, partial fill and prehistory excursion boundary. Conservative M5 sampling currently starts from the next rounded closed-bar boundary; do not claim precise lifetime MFE parity until proven by signed venue evidence. Keep default OFF.
4. ENTRY OWNER COMPATIBILITY: existing Idle baseline admission requires **flat CORE** and no competing baseline pending/accepted signal, so it is NOT equivalent to every independently profitable raw RENDER candidate. Historical study had 11 market candidates, only 3 Native8 wallet accepts under normal selection; with 0.75x a 10bps accepted trade had actual modeled Gross about .63 because of available-cap constraints. The staged independent admission now sizes dynamically between .25x and .75x using checked free gross; this is distinct from the legacy fixed 0.25x contract. Resolve these real/wallet parity differences with a fresh, fully integrated model and defensive shared risk before certification. NEVER claim that priority 0.75 will trade all 11 raw signals.
5. LIVE CERT/CI: candidate SHA exact CI, test suite, bounded true-forward Shadow, certified venue protection and the new root-owned SHA-bound certificates required for BOTH routes. Promote/release with exact rollback marker. Do NOT change shared-risk trip limits / override fail-closed flags to make it pass. Final operator activation must be conscious and audited.
6. HP: expose legacy early adverse state/exit reason and independent route, 0.75x Gross, 5x margin, entry Gate reasons, blocked-by-incumbent vs blocked-by-core, 6h exit time and protection status under 判定状況, not misleadingly as ordinary legacy RENDER.

## Ready-to-review evidence

- config/research/render-dual-production-approved-handoff-20261026.json
- docs/implementation/RENDER_NOSHADOW_EXIT_BT_20261026.md
- docs/implementation/RENDER_GROSS075_PRIORITY_TP25_H6_RESEARCH_20261026.md
- docs/research/results/render-dual-20261026/RENDER_GROSS075_TP25_H6_PRIORITY_NATIVE8_COMPARISON_20261026.json
- lib/render-independent-execution-contract.ts
- lib/render-legacy-adverse-cert.ts
- tests/render-independent-route-gross-admission.test.ts
- tests/render-legacy-adverse-cert.test.ts

## Final cutover contract

Codex is tasked with independent review of the staged branch, address documented parity/evidence gaps, then only after passing evidence promote the exact merged SHA to an operator-prepared release, preserve rollback, have the operator approve and perform the final LIVE cutover. The assistant has NOT created/filled certificates, placed/cancelled orders, deployed any VPS release, enabled flags, or claimed a currently bookable/live signal. If any required proof is unavailable, report BLOCKED with evidence rather than pretending Codex merely toggles a switch.


## Extra core-flat replay: guard against overstated independence

A 2026-10-26 archived Native8 research replay explicitly prefilters all 11 raw
independent entry timestamps using the unmodified base-wallet historical
position/accepted-signal ledger at both costs. **Only one timestamp**
(2026-05-28 01:00 UTC) has neither a standing baseline position nor a
simultaneous core entry. With the same TP+2.5%, STOP-2%, 6h cap and
capacity-reduced Gross <=0.75, repeated full-wallet economics are:

- 10bps: final JPY 281,029,648, 1 independent accepted trade at Gross
  0.630793x; DD -14.515%; total 1,288 closed trades; 3 repeats PASS.
- 30bps: final JPY 169,522,781, 1 independent accepted trade at Gross
  ~0.75x; DD -15.015%; total 1,285 closed trades; 3 repeats PASS.

Both are modeled, NOT signed/live parity. Compared with historical
legacy-stop-only JPY 279,087,048 / JPY 169,095,336, improvements are
approximately JPY +1.943m / +0.427m. Previous 3-trade research scenario
JPY 281,254,554 / JPY 169,494,414 is now recorded as a separate
**unrestricted owner-model case**, not the production admission forecast.
Source evidence: docs/research/results/render-dual-20261026/
RENDER_CORE_FLAT_PARITY_NATIVE8_20261026.json.

Codex must either (A) respect the current flat-core admission restriction and
validate this more restrictive 1-trade interpretation against current VPS and
live decision source, or (B) design a separately certified shared-ownership
admission that allows some concurrent core positions without ever preempting
protected incumbents, then rerun full combined 8-sleeve economics at both
transaction costs. Option B is NEW strategy logic and is not a simple
permission toggle; do not pretend the present branch already supports it.
