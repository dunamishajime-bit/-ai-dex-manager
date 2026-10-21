# V12 V4 LONG: full TIME37 and +2% floor STOP integration study (2026-10-21)

> Research only; no LIVE or VPS changes. User-selected +3% to +1% retained on tested 3 routes.

## Reproduced 8-logic full compounding baseline

Initial ¥10,000, no deposits, 2025-08-10–2026-08-10, 10bps main / 30bps stress. Portfolio MTM DD.

| Stage | 10bps final | 30bps final | 10bps profit change vs baseline | 30bps profit change vs baseline | 10bps DD delta | 30bps DD delta | Original winners cut early (10bps) | Historical losers improved (10bps) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Original X09/X10/X14 +3→+1, H1 down2 | ¥222,373,711 | ¥123,696,117 | -0.200% | -0.477% | +0.0000pp | +0.0000pp | 1 | 0 |
| TIME37_LONG_PLUS3_TO_PLUS1_BEAR2 | ¥220,086,215 | ¥120,645,814 | -1.226% | -2.932% | +0.0000pp | +0.0000pp | 7 | 0 |
| TIME37_PLUS3TO1_AND_PLUS2_FLOOR_NEG0P5 | ¥204,662,408 | ¥76,428,256 | -8.149% | -38.511% | +0.0038pp | -0.0230pp | 20 | 3 |
| TIME37_PLUS3TO1_AND_PLUS2_FLOOR_ZERO | ¥203,194,056 | ¥73,926,557 | -8.808% | -40.524% | -0.0053pp | -0.0320pp | 26 | 5 |
| TIME37_PLUS3TO1_AND_PLUS2_FLOOR_PLUS0P5 | ¥203,631,862 | ¥77,913,574 | -8.611% | -37.316% | +0.0078pp | -0.0197pp | 35 | 6 |
| X3_PLUS3TO1_AND_PLUS2_FLOOR_ZERO | ¥220,981,344 | ¥113,172,587 | -0.825% | -8.945% | +0.0057pp | -0.0322pp | 5 | 3 |

## Findings

- Full TIME37 one-size-fits-all +3→+1 itself is expensive in final assets and rescues **zero** baseline losing LONG positions; not adopted.
- After a +2% favorable peak, modeled 5m resident-like STOP floors at -0.5%, 0%, +0.5% across all 37 routes rescue 3–6 original 10bps losers, but close 20–35 historical winners early. In the 30bps sensitivity, 15–28 winner exits and severe wealth erosion.
- Restricting +2%→0% protective STOP to the three originally tested routes rescues 3 original losers but closes 5 historical winners early; 30bps DD and final equity worsen versus the already selected pure +3→+1 policy.
- No new candidate passes the dual-cost +0.10pp portfolio MTM DD improvement gate. The user-selected primary is carried as a discretionary profit-protection objective, not recertified as a DD-enhancing strategy.

## Critical distinction: true venue vs modeled profit protection

- The selected two confirmed-H1 down candles + next M5 modeled market EXIT is **not** a guaranteed +1% profit floor.
- The proposed +2% M5 STOP model triggers only on the NEXT 5m bar after the favorable high: no same-bar high/low hindsight. A gap is assumed to fill at the adverse open (less modeled friction). This remains an approximation and can over/under-estimate live venue order behavior.
- Current Production V4 LONG TIME initial exchange protection is -8%; the runtime validates stop quotes below entry and recalculates fixed original STOP on reconciliation. Raising resident STOP above entry requires explicit, tested new implementation rather than modifying a research boolean.
- If the user requires protection from a +2% peak, the safest next research path is narrower per-route controls and/or partial exits that keep exposure protected, not a 37-route universal tight STOP.

## Integration status and safety

- No runner shutdown/restart, no order changes, no venue cancel/place, no release/operator marker changes.
- The signed resident STOP ownership, original emergency -8% order, persistent per-leg MFE, safe replacement read-back before retiring old STOP, partial fill/stop race, account/shared lock, rates, restart recovery, venue and rollback must be proven before LIVE.
- Research uses frozen 8-logic economic allocator and 5m trade overlay; parity to the new Task9 independently implemented TypeScript dynamic allocation is not certified.

## Evidence/reproduce

Source catalog: V12_V4_LONG_FROZEN_TIME37_ROUTE_CATALOG_20261021.json (37 TIME, 3 ATR, 1 NATIVE).
Economic result: V12_V4_LONG_TIME37_PLUS2_RESIDENT_LIKE_COMPARISON_20261021.json.
Execution research: scripts/dd-reduction/run-task9-v4-long-time37-profit-stop-20261021.py.
Causal tests: scripts/dd-reduction/test-v4-long-time37-profit-stop-20261021.py.
Raw full8 case ledgers retained only in PC research directory, not pushed; no signed venue access was required.

## Independent re-execution

- X09/X10/X14 +3→+1 H1 rule with +2% breakeven protective floor was recomputed from the frozen source into a fresh separate output directory at both 10bps and 30bps.
- **10/10** SHA256 hashes matched exactly for five complete economic ledgers per cost (candidate decisions, portfolio trades, portfolio events, H1 MTM and metrics); full proof in V12_V4_LONG_TIME37_X3_REPEAT_SHA_PROOF_20261021.json.
- This proves research replay determinism, not LIVE exchange STOP lifecycle, independent TypeScript engine parity or a new untouched holdout.
