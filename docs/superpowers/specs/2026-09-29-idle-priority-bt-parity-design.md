> **2026-09-30 controlling cost/replay correction:** Economic parity is governed by `docs/implementation/IDLE_PRIORITY_COST_RECONCILIATION_20260930.md`. The historical JPY268.05M / 1,342 / PF~2.055 / DD~-23.24% bundle mixes incompatible cost/replay outputs and is not a valid single-run 10bps certificate. Signal/candidate semantics in this design remain controlling unless explicitly corrected.

> **2026-09-30 parity correction:** Historical JPY268.05M parity is governed by `docs/implementation/IDLE_PRIORITY_HISTORICAL_OVERLAY_PARITY_CORRECTION_20260930.md`. The 63 Idle rows were prequalified from baseline-only idle windows and the 63→61 exclusions are same-symbol Idle occupancy at DOT 1780318800000 and TIA 1784250000000. Do not re-gate those rows against a newly path-dependent integrated baseline candidate state when reproducing the historical overlay.

# Idle Priority SHORT — ¥268.05M BT Parity Design

Date: 2026-09-29  
Status: DESIGN — implementation must not begin until this written spec is reviewed and approved.  
Repository: `dunamishajime-bit/-ai-dex-manager`

## 1. Purpose

Add a production-safe, dedicated Aster crypto sleeve that preserves the verified Idle signal/admission behavior from the historical research while using a coherent, explicitly identified cost/replay model. The adopted primary economic reference is the 10bps fixed-intent dynamic-Gross overlay; the old ¥268.05M headline is retained only as a historical mixed-report label.

The governing requirement is **BT parity first**. The implementation must not introduce a different priority rule, partial sizing rule, preemption behavior, entry route, hold time, or signal threshold just because it seems operationally convenient.

## 2. Controlling Backtest Evidence

The filtered candidate evidence used for the adopted Idle variant is:

- local analysis artifact: `idle_candidate_filtered.csv`
- SHA256: `5029baad39bd07c9fc40ec4ba75941cb089697d5cebc437c29838cbc924f3e48`
- bytes: `22,234`
- candidate rows: **63**
- all rows are **SHORT**
- route counts:
  - `DOT_MOMENTUM_SHORT_BTCREL`: 15
  - `JUP_RELATIVE_SHORT`: 14
  - `RENDER_RELATIVE_SHORT`: 15
  - `TAO_BREAKDOWN_SHORT_RELWEAK2`: 9
  - `TIA_BREAKDOWN_SHORT_VOLCAP100`: 10

The integrated replay admitted **61** of those candidates. The actual admitted trade win rates were:

| Symbol | Admitted | Wins | Losses | Win rate |
| --- | ---: | ---: | ---: | ---: |
| TAO | 9 | 8 | 1 | 88.9% |
| DOT | 14 | 11 | 3 | 78.6% |
| JUP | 14 | 11 | 3 | 78.6% |
| TIA | 9 | 7 | 2 | 77.8% |
| RENDER | 15 | 11 | 4 | 73.3% |
| **Total** | **61** | **48** | **13** | **78.7%** |

The historical report previously labeled the integrated result as “10bps ¥268.05M”, but cost/replay reconciliation disproved that as a coherent single run.

Primary coherent 10bps fixed-intent dynamic-Gross reference:
- final equity: approximately **¥214.78M**
- integrated trades: **1,339**
- PF: approximately **2.04643**
- diagnostic hourly DD: approximately **-22.84%**
- Idle sleeve: **61 trades / 48W 13L**
- Idle PF: approximately **6.583**

8bps sensitivity:
- final equity: approximately **¥268.15M**
- integrated trades: **1,339**
- PF: approximately **2.09255**
- diagnostic hourly DD: approximately **-22.69%**

These numbers are acceptance anchors, not permission to retune until the result matches. If implementation-parity replay materially differs, stop and explain the discrepancy.

## 3. Strategy Identity

Production strategy family:

`IDLE_PRIORITY_SHORT`

Child route identities:

- `IDLE_TAO_BREAKDOWN_SHORT_RELWEAK2`
- `IDLE_TIA_BREAKDOWN_SHORT_VOLCAP100`
- `IDLE_DOT_MOMENTUM_SHORT_BTCREL`
- `IDLE_JUP_RELATIVE_SHORT`
- `IDLE_RENDER_RELATIVE_SHORT`

Symbols:

- `TAOUSDT`
- `TIAUSDT`
- `DOTUSDT`
- `JUPUSDT`
- `RENDERUSDT`

All entries are **SHORT**.

## 4. Exact Idle-Regime Admission Contract

The Idle sleeve may evaluate an entry only when, at that decision timestamp:

1. There is **no open position owned by any of the five baseline strategies**:
   - V12
   - PENGU
   - Q102
   - FET
   - V52
2. There is **no newly accepted baseline-five entry at that same decision timestamp**.
3. There is no unresolved/pending baseline-five order submission that could create exposure but has not yet been reflected in the position snapshot.
4. Shared Kill Switch, Shared Risk, Margin Guard, account lock, pending-exposure registry, venue/account freshness, and operator activation checks all pass.

This is deliberately different from “Idle wins a tie.”  
If the baseline five accept an entry at the same timestamp, **baseline five win and Idle does not enter**.

The historical Idle candidates had:
- exact timestamp overlap with baseline-five actual entries: **0**
- exact timestamp overlap with baseline-five candidate decisions: **0**

Therefore the live implementation must not manufacture a new “Idle-first” tie-breaker that did not contribute to the ¥268.05M result.

## 5. Existing Non-Baseline Sidecars

The ¥268.05M replay did not model later sidecars such as the current HYPE overlay.

To avoid silently creating a new sizing regime:

- If a non-baseline crypto sidecar already consumes exposure or has pending exposure at the Idle entry timestamp, **Idle entry fails closed**.
- Do not enter 0.5x, 0.3x, or any other residual size merely because that much capacity remains.
- Do not close or reduce HYPE or another sidecar to create room.

This restriction applies to **new Idle entries** only. It does not authorize interference with already-open positions.

## 6. Sizing and Venue Contract

For each accepted Idle entry:

- requested gross: **1.00x**
- accepted gross: **must equal 1.00x**
- partial entry: **forbidden**
- leverage configuration: **5x**
- margin mode: **Cross**
- 5x Cross must be verified at venue/readback before or as required by the existing guarded execution path
- if full 1.00x cannot be admitted under shared risk / margin / pending exposure / minimum quantity rules: **skip the Idle entry**

The 5x leverage setting is a venue margin-efficiency constraint; it does **not** multiply 1.00x strategy gross into 5.00x portfolio gross.

## 7. Signal Inputs and Feature Timing

Use only **fully closed H1 candles**.  
No current/incomplete candle may influence entry.

Feature calculations must be deterministic and covered by parity fixtures from the 63-row candidate evidence.

Definitions are anchored to the candidate evidence timestamps. For a decision timestamp `t`, the signal bar is the H1 bar whose open/event time is `t - 1h`; the H1 bar opening at `t` is not yet part of the signal.

- `ret12 = close[t-1h] / close[t-13h] - 1`
- `ret24 = close[t-1h] / close[t-25h] - 1`
- `btc24 = BTC close[t-1h] / BTC close[t-25h] - 1`
- `rel24 = ret24 - btc24`
- True Range for an H1 bar = `max(high-low, abs(high-prevClose), abs(low-prevClose))`
- `ATR ratio = mean(TR over the 14 completed H1 bars ending at t-1h) / close[t-1h]`
- `Volume Ratio = quoteVolume[t-1h] / median(quoteVolume over the 72 completed H1 bars immediately before t-1h)`
- 24h breakdown SHORT = `close[t-1h] < min(close of the 24 completed H1 bars immediately before t-1h)`

The generic research candidate archetype gates that precede the symbol-specific filters are also part of parity:

- BREAKOUT SHORT candidate:
  - 24h breakdown SHORT = true
  - `Volume Ratio >= 1.30`
  - `ATR ratio >= 0.007`
- MOMENTUM SHORT candidate:
  - `ret12 <= -0.03`
  - `Volume Ratio >= 1.00`
  - `ATR ratio >= 0.007`
- RELATIVE SHORT candidate:
  - `rel24 <= -0.03`
  - `Volume Ratio >= 0.80`
  - `ATR ratio >= 0.007`

The 63-row filtered evidence was produced from a broader 495-row research candidate stream. Applying only the simplified per-symbol filters directly to every idle H1 bar produces extra signals, so LIVE must not omit the generic candidate-generation layer or its per-symbol candidate lifecycle/cooldown semantics. The implementation is not accepted until replay fixtures reproduce the exact 63 filtered candidates and no extras.

No alternate Binance data source, changing vendor history, or approximate indicator implementation may be substituted for the live signal calculation without a parity proof.

## 8. Exact Route Rules

### 8.1 TAO

Route: `IDLE_TAO_BREAKDOWN_SHORT_RELWEAK2`

Required:
- generic BREAKOUT SHORT candidate gate passes
- `rel24 <= -0.02`
- same-symbol candidate lifecycle/cooldown satisfied

Hold:
- **12 hours**

### 8.2 TIA

Route: `IDLE_TIA_BREAKDOWN_SHORT_VOLCAP100`

Required:
- generic BREAKOUT SHORT candidate gate passes
- `Volume Ratio <= 100`
- same-symbol candidate lifecycle/cooldown satisfied

Hold:
- **24 hours**

### 8.3 DOT

Route: `IDLE_DOT_MOMENTUM_SHORT_BTCREL`

Required:
- generic MOMENTUM SHORT candidate gate passes
- `btc24 <= 0`
- `rel24 <= 0`
- same-symbol candidate lifecycle/cooldown satisfied

Hold:
- **24 hours**

### 8.4 JUP

Route: `IDLE_JUP_RELATIVE_SHORT`

Required:
- generic RELATIVE SHORT candidate gate passes
- same-symbol candidate lifecycle/cooldown satisfied

Hold:
- **12 hours**

### 8.5 RENDER

Route: `IDLE_RENDER_RELATIVE_SHORT`

Required:
- `rel24 <= -0.03`
- same-symbol cooldown satisfied

Hold:
- **12 hours**

## 9. Cooldown

Per-symbol cooldown:

- **12 hours**
- applies per symbol across the broader candidate-generation lifecycle, not only across the final selected route
- the evidence stream has a minimum observed same-symbol candidate spacing of 12h
- implementation tests must reproduce the exact evidence timestamps before the cooldown is considered understood

No global cooldown across all five symbols.

Because direct route-only scanning yields extra candidate timestamps, the implementation must first reconstruct and test the broader candidate-generation/cooldown lifecycle against the saved evidence before production code is allowed to arm LIVE.

## 10. Multi-Symbol Same-Timestamp Behavior

The backtest had at least one same-timestamp multi-symbol Idle occurrence.

Therefore:

- do not impose a TAO > TIA > DOT > JUP > RENDER ranking unless the replay proves such a ranking existed
- independently evaluate all five symbols for that closed H1 timestamp
- admit each qualifying Idle entry only if each can receive a full 1.00x under the same shared portfolio plan
- never partially size the second candidate merely to fit it

If shared portfolio capacity cannot admit all same-timestamp qualifying Idle intents at full 1.00x and the original replay does not prove a deterministic ordering, fail closed for the ambiguous excess candidate(s) and surface the reason in state/HP rather than inventing a priority.

## 11. Exit Contract

Strategy exit is time-based, matching the replay:

- TAO: 12h
- TIA: 24h
- DOT: 24h
- JUP: 12h
- RENDER: 12h

A later V12 / PENGU / Q102 / FET / V52 signal does **not** force an already-open Idle position to exit.

The later baseline strategy is evaluated under the normal shared gross / margin constraints with the Idle position included in current exposure.

No “give the slot back to baseline” preemption is allowed for an open Idle position.

## 12. Venue-Side Emergency Protection

Production must not leave an open leveraged position without venue-side protection.

Emergency protection is operational safety, not a strategy optimization:

- emergency STOP: **10% adverse move**
- emergency TP: **25% favorable move**
- reduce-only
- readback required after placement
- missing or ambiguous protection => fail closed / manual review using existing production safety conventions

Research evidence for the 63 filtered candidates:
- worst hold-window MAE: approximately **-7.81%**
- best hold-window MFE: approximately **+22.15%**

Thus neither 10% emergency stop nor 25% emergency TP would have fired on those 63 historical candidate paths; the fixed 12h/24h exit remains the replay strategy exit.

These emergency levels must not be tightened without a new integrated BT.

## 13. Interaction With Baseline Five After Entry

After an Idle position exists:

- keep the Idle position until its strategy exit or emergency protection
- baseline-five strategies continue to evaluate normally
- include Idle exposure in shared crypto/total gross
- baseline-five entries may coexist if normal portfolio constraints allow
- Idle position must not be reduced merely to admit a later baseline-five entry
- Idle may not bypass global Gross, Shared Risk, Margin Guard, pending-exposure, minimum-quantity, or daily-loss limits

This behavior is necessary because many historical Idle positions overlapped later baseline-five entries during their 12h/24h hold.

## 14. Execution Architecture

Implement as a **dedicated production runner**, not inside V12 and not inside HYPE.

Reason:
- Idle has independent symbols, SHORT-only rules, H1 timing, fixed hold exits, and BT-parity admission semantics.
- V12 modification would expand regression risk to the highest-volume existing strategy.
- HYPE is a different LONG overlay with different cadence and policy.

Proposed clear units:

1. `config/idlePriorityShortPolicy.ts`
   - immutable symbols, thresholds, hold times, gross=1.0, leverage=5, cross, cooldown, emergency protections
2. `config/idlePriorityShortRuntime.ts`
   - operator-gated LIVE/SHADOW runtime config, SHA pinning, state paths
3. `lib/idle-priority-short-signal.ts`
   - closed-H1 feature computation and pure route evaluation
4. `lib/idle-priority-short-idle-gate.ts`
   - baseline-five position/pending/new-acceptance gate
5. `lib/idle-priority-short-market-data.ts`
   - Aster H1 + BTC H1 loading with freshness and closed-bar guarantees
6. `lib/idle-priority-short-state.ts`
   - atomic SHA-bound state, pending entry/exit phases, cooldown and ownership
7. `lib/idle-priority-short-runner.ts`
   - account lock, reconciliation, full-1.0 planning, order submission, protection readback, fixed-hold exit
8. `scripts/disdex-idle-priority-short-live-runner.ts`
   - production entrypoint
9. `ops/systemd/disdex-idle-priority-short@.service`
   - SHA-pinned, operator-gated service
10. watchdog/current-runtime-wiring/health snapshot integration
11. trade-history attribution and HP observability additions

Use the existing:
- strict portfolio planner
- integrated gross governor
- pending exposure registry
- shared account/order lock
- direct trade executor
- operator activation gate
- kill switch / shared risk / margin guard conventions

Do **not** reuse HYPE/ZEC preemption code because Idle positions are not preemptible under the adopted BT.

## 15. State and Ownership

State must be:
- atomic
- SHA-bound
- root/deploy ownership consistent with existing runner conventions
- fail closed on malformed/stale/different-SHA state
- explicit about pending entry / pending exit / manual review

The runner owns only:
- TAOUSDT
- TIAUSDT
- DOTUSDT
- JUPUSDT
- RENDERUSDT

and only positions it can prove were created by `IDLE_PRIORITY_SHORT`.

Unknown pre-existing positions or orders in those symbols must not be adopted silently.

## 16. Safety and Failure Modes

No order submission when any of these is unresolved:

- operator artifact missing / SHA mismatch
- Kill Switch active
- account snapshot stale/unavailable
- H1 data incomplete/stale
- baseline-five ownership unknown
- baseline-five pending exposure unknown
- non-baseline sidecar exposure present at new Idle admission
- account lock unavailable
- gross planner ambiguous
- full 1.00x unavailable
- leverage/margin mode not confirmed
- exchange filters unavailable
- normalized quantity below safe minimum
- existing unknown order on target symbol
- position ownership mismatch
- protective order installation/readback failure
- state pending from prior uncertain execution
- runtime SHA mismatch

No test order or forced position is allowed solely to prove deployment.

## 17. BT-Parity Acceptance Tests Before LIVE

LIVE activation is blocked until all are true:

1. Candidate fixture replay reproduces **all 63** filtered candidates from the evidence CSV.
2. No extra candidate appears inside the same fixture scope.
3. Route counts reproduce exactly 15 / 14 / 15 / 9 / 10.
4. Per-route target-hold win counts reproduce the evidence.
5. Integrated replay reproduces **61 admitted Idle trades** under the same baseline-five ledger.
6. Integrated replay reproduces the Idle trade win count **48 / 61**.
7. Cost and replay identity are explicit. The primary 10bps run reconciles to the coherent 1,339-trade / ~¥214.78M reference; 8bps is reported separately and must never be combined with 10bps baseline/PF/DD.
8. Every divergence is explained; no threshold is retuned to force parity.
9. Explicit tests prove same-timestamp baseline-five accepted entry blocks Idle.
10. Explicit tests prove open Idle is not preempted by later baseline-five signal.
11. Explicit tests prove 0.5 residual capacity causes **skip**, not partial Idle entry.
12. Explicit tests prove HYPE/non-baseline exposure causes new Idle admission to fail closed.
13. Explicit tests prove 5x Cross requirement and full 1.00x gross contract.
14. Explicit tests prove 12h/24h hold boundaries and 12h per-symbol cooldown.
15. Emergency 10% stop / 25% TP do not alter the 63 historical candidate paths.

## 18. HP / Website Contract

Keep the current no-ZEC HP behavior. Do not restore ZEC wording.

Add Idle visibility to:

- home / runtime summary
- sidebar
- decision-status overview
- dedicated `/decision-status/idle-priority`
- five symbol rows with:
  - route
  - closed H1 timestamp
  - ret12
  - ret24
  - btc24
  - rel24
  - volume ratio
  - breakdown gate
  - cooldown
  - baseline-five Idle gate
  - full-1.00 capacity gate
  - 5x Cross gate
  - final decision / rejection reason
- trade history
- logic-specific history
- performance summary
- positions / strategy attribution
- runner/runtime health

HP endpoints are read-only and must not be capable of submitting/cancelling orders.

Retired ZEC deep links remain retired/no-ZEC.

## 19. Deployment Contract

Before any production mutation:

1. Fresh READ-ONLY probe actual VPS.
2. Capture actual current Production SHA and UI SHA.
3. If Production is newer than the design base `54ed0cd5...`, do not reset or force checkout backward.
4. Implement/cherry-pick onto the actual current production lineage.
5. Preserve all currently open positions and protective orders.
6. Run full compile/tests/parity replay/safety selftests.
7. Create isolated versioned release + rollback.
8. Create/validate root-owned operator activation artifact for the exact new SHA.
9. Start the new Idle runner only after all existing core runners and risk services remain healthy.
10. Do not force an Idle entry during deployment.
11. Verify runtime SHA parity, service PID/restarts, Kill Switch, Shared Risk, Margin Guard, pending registry, account locks, open positions/orders, protections, disk, API health, and HP.

Final status may be:
- `LIVE_ACTIVATED_VERIFIED`
- or `BLOCKED_<EXACT_REASON>`

Never report LIVE from code/CI alone.

## 20. Non-Goals

This implementation does **not**:
- retune the five Idle routes
- add LONG variants
- rank Idle above baseline five
- use residual partial sizing
- preempt baseline-five positions
- make Idle itself preemptible for later baseline signals
- revive ZEC
- change HYPE strategy rules
- change V12/PENGU/Q102/FET/V52 signal logic
- change global risk caps merely to fit Idle
- change the adopted V12 normal-gate thresholds
- reinterpret leverage as strategy gross multiplication

## 21. Implementation Stop Conditions

Stop before LIVE if:
- the 63-candidate fixture cannot be reproduced exactly,
- the integrated replay cannot reconcile the 61 admitted trades,
- current VPS lineage differs in a way that changes admission semantics,
- existing active positions cannot be safely classified,
- full 1.00x sizing cannot be proven under live planner semantics,
- or any operator/risk/protection contract is unresolved.

Do not “solve” a parity failure by loosening thresholds or adding priority behavior.
