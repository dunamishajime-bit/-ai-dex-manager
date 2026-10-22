# HYPE LONG + RENDER/TAO Idle SHORT — 正式採用・Codex実装Handoff (2026-10-22 JST)

## Status / operator intent

**USER-ADOPTED ECONOMIC RESEARCH POLICY; GIT PUSH APPROVED; NOT A LIVE CUTOVER.**

The user formally adopted HYPE LONG new entry + dual exits and the combined three Idle SHORT rules. The exact forward-research and future implementation baseline is **TAO_RET1H_PLUS_RENDER_SKIP_AND_PROFIT** at both 10bps and 30bps. Prior user-adopted V12 V4 four exits, Q102 three exits and all unrelated strategy behavior remain fixed.

### Exact side scope

- **HYPEUSDT**: HYPE_LONG only. No HYPE SHORT.
- **TAOUSDT**: additional Idle Priority SHORT entry filter only.
- **RENDERUSDT**: additional Idle Priority SHORT entry veto and profit protection only.
- **DOTUSDT**: no change. Keep existing confirmed M5 +3% best-profit arm and 1.5 percentage-point giveback trail.
- TIA/JUP/PENGU/FET/V52/V12/Q102 unchanged. Never apply an Idle symbol condition to another strategy owner.
- Idle generic LONG archetype candidates can occupy a candidate lifecycle slot, but Idle Priority SHORT does not place LONG orders. Do not create TAO/RENDER LONG here.

## Canonical sources

- Formal selected policy: config/research/hype-render-tao-cumulative-adopted-20261022.json
- Pure TypeScript decision helpers, **not yet wired to LIVE runner**: lib/hype-render-tao-adopted-policy.ts
- Tests: tests/hype-render-tao-adopted-policy.test.ts
- Previously adopted HYPE: config/research/hype-entry-adopted-20261022.json
- Original Idle proposal (historical, superseded): config/research/idle-five-short-next-candidate-20261022.json
- 8-logic causal BT: docs/research/results/idle-five-short-winrate-20261022/IDLE_FIVE_SHORT_CAUSAL_FULL8_REPORT_20261022.md
- DOT exit study (all three extra guards rejected): docs/research/results/dot-short-profit-guard-20261022/DOT_SHORT_PROFIT_GUARD_FULL8_REPORT_20261022.md
- Research engine: scripts/dd-reduction/run-idle-five-entry-full8-after-hype-20261022.py

## Exact pre-entry causal thresholds

Use **fully completed, exactly aligned, continuous M5 closes** and percentage points, not decimal price-return fractions. Last confirmed M5 bar open is decision timestamp minus 300000ms; require N+1 closes at exact M5 spacing. Missing, duplicate, stale, unfinished, misaligned or invalid bars block that symbol's new entry without globally altering locks. No BTC-only fallback, no coin-volume confusion, no lookahead.

1. **HYPE LONG**, beyond original native entry rules: BTC 3h percent return <= +0.6%; HYPE 3h return minus BTC 3h return >= +2.0 percentage points. 36 M5 lookback intervals for BOTH HYPE and BTC.
2. **TAO Idle SHORT**, beyond original generic/archetype/native route: TAO 1h percent return <= -1.0%. 12 M5 intervals.
3. **RENDER Idle SHORT**, beyond existing native Idle route: VETO *only when both* BTC 6h percent return > 0 AND (RENDER 6h percent return minus BTC 6h return) > 0. Otherwise accept the additional veto gate if history is valid. 72 completed M5 intervals for BTC AND RENDER.

Keep existing Idle generic candidate lifecycle / cooldown ownership and do not let a LONG candidate pass as an Idle SHORT.

## Exit contracts, actual fill and STOP lifecycle

**HYPE LONG early adverse:** when time since actual fill >=60 minutes, highest favorable excursion since actual fill is strictly < +0.3%, AND actual price return from average filled entry <= -1.0%, exit LONG. Persist entry, quantity, elapsed entry time, MFE/high-water state across restart and partial fill.

**HYPE LONG profit guard:** after a confirmed M5 close first demonstrates >=+3.0% gain from actual entry, protect at +1.5% from entry (LONG sell protective stop at filled average price * 1.015). No same-bar activation. Earlier legacy exits take priority; retain existing HYPE75 native protections.

**RENDER Idle SHORT profit guard:** after confirmed M5 close first demonstrates >=+1.5% gain, protect +0.25% from filled entry (BUY protective stop at entry price * 0.9975). Only subsequent bars can cross newly armed stop. Existing earlier exits win. Preserve original +3% / 1.5-percentage-point trailing stop: the more protective SHORT stop is the lower stop price. A 0.25% *gross price floor is NOT guaranteed net PnL* under 30bps or slippage, and gaps may cross stop.

For HYPE and RENDER, every STOP creation/replacement must be reduce-only, quantity-correct, idempotent, signed venue accepted and read back; reconcile pre-existing STOP/TP, partial fills, time exit races and process restarts. Never place double conflicting STOPs. Unknown state -> no new exposure and operator review, no fabricated successful venue certification.

## Exact modeled integrated economics (historical, in-sample)

2025-08-10 through 2026-08-10, 1万円 initial capital, no further deposits, compounding, all eight strategies dynamically reselected after overlay gates and exits. HYPE adopted dual exits, V12 V4, Q102 and PENGU unchanged.

| Cost model | HYPE-only baseline | HYPE + TAO/RENDER all three | Delta | Max MTM DD |
|---|---:|---:|---:|---:|
| 10bps | 231,889,902円 | **239,985,735円** | +8,095,832円 | -14.60331% |
| 30bps stress | 129,855,822円 | **135,946,895円** | +6,091,073円 | -15.80771% |

- 10bps RENDER SHORT: 15 wins, 9 losses, 62.5%. TAO SHORT: 5 wins, 0 losses.
- 30bps RENDER SHORT: 10 wins, 12 losses, 45.45%. TAO SHORT: 6 wins, 0 losses.
- Alternative two-rule-only TAO + RENDER entry, excluding new RENDER guard: 30bps 136,216,673円; +269,778円 higher than triple-rule stress. User nevertheless selected triple rules and normal 10bps model for formal adoption.
- TAO 5/6 winning is a *tiny, optimized in-sample subset*; do not imply future certainty.
- Maximum DD unchanged in 10bps selected model. The economic model is not an untouched out-of-sample or signed exchange execution proof.
- Unmodified DOT exit study confirmed early protection shrinks aggregate return; no DOT changes authorized.

## Codex implementation / certification tasks

1. Read current GitHub and **actual VPS Production** release SHA / rollback, live position/order state, ownership, exposure and STOP state. Do not treat historical research SHA as today's Production.
2. Wire pure helpers into actual signal and order runtime paths: HYPE LONG pre-entry candidate gate, Idle TAO and RENDER gates **after generic lifecycle but before exposure/reservation/order**, each with fully completed M5 snapshot. Use bounded shared-rate-budget requests and no future data. Do not block unrelated strategies on missing symbol data.
3. Wire HYPE two exit conditions and RENDER confirmed M5 protective guard into persistent venue-backed STOP lifecycle, with fill price/quantity and monotonic stop precedence; do not replace incumbent protection without atomic signed read-back.
4. Add certified tests for thresholds, exact H1/M5 boundaries, price offsets, stale/missing bars, HYPE side isolation, TAO/RENDER Idle-only scope, DOT/TIA/JUP unchanged, restarted positions, partial fills, STOP/TP races, shared account/rate-budget locks.
5. Reproduce **the selected triple-rule 8-logic BT** with the canonical inputs, plus independent unified **Task9 TypeScript** economic parity, not just Python recreation. Obtain untouched out-of-sample and venue slippage/fee comparison when data permit. Cost 10bps normal, 30bps stress.
6. Only after required operator approval and signed venue lifecycle verification, prepare a separately authorized staged LIVE cutover and HP sync. No safety gate bypass; no manual order action is authorized by this Git handoff.

## Test and replay

- Node unit test (18 cases, as of authoring): npx --no-install tsx tests/hype-render-tao-adopted-policy.test.ts
- Research replay on authorized Windows research data root: python scripts/dd-reduction/run-idle-five-entry-full8-after-hype-20261022.py --cases TAO_RET1H_PLUS_RENDER_SKIP_AND_PROFIT --output RESEARCH_OUTPUT_DIR

Research inputs historically reside on the authorized Windows PC; do not fake portable provenance. Prefer an independently content-hashed input manifest. Git index line endings: **LF**.

## No false LIVE claim

This branch contains formally user-adopted scope, pure tested policy functions and Codex integration requirements. **It does not activate new LIVE orders, deploy a VPS release, prove actual exchange STOP correctness, or certify independent TypeScript Task9 parity.** Fail-closed shared risk, margin guard, kill switch and operator artifact rules remain mandatory.
