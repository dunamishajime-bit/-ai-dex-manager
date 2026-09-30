> **SUPERSEDED FOR ECONOMIC PARITY (2026-09-30):** `docs/implementation/IDLE_PRIORITY_COST_RECONCILIATION_20260930.md` is controlling. This file remains authoritative for the exact 63→61 same-symbol exclusions, but its former JPY268.05M / 1,342 acceptance target was disproven as a coherent 10bps run.

# Idle Priority SHORT — Historical Overlay Parity Correction (2026-09-30)

Status: **CONTROLLING PARITY CORRECTION** for the historical JPY268.05M research result.

This document corrects an important ambiguity in the earlier handoff/spec. The JPY268.05M research run was not produced by re-running every baseline candidate decision under a newly path-dependent integrated allocator. It was an **overlay replay on top of the already accepted baseline trade ledger**.

## 1. Canonical baseline

GitHub Release:

`bt-v12-score100-volume080-normalonly-20260928`

Adopted 10bps baseline:
- final equity JPY 141845207.7243423
- closed trades 1284
- V12 991 / PENGU 63 / Q102 130 / V52 85 / FET 15
- PF 2.0771737482823114
- max MTM DD -22.873351303266531%

The 1284 accepted baseline trades are the historical overlay input. Do **not** regenerate/promote baseline candidates that were rejected in the baseline-only run merely because an earlier Idle trade changed actual-path capacity.

## 2. Canonical Idle candidate evidence

`idle_candidate_events.csv`
- 495 rows
- 149207 bytes
- SHA256 09e97db7a812728f5e54c1179c8e39ac30c6dba4fea241a9d415fa4810f8adbb

`idle_candidate_filtered.csv`
- 63 rows
- 22234 bytes
- SHA256 5029baad39bd07c9fc40ec4ba75941cb089697d5cebc437c29838cbc924f3e48

The 63 rows were selected from **baseline-only idle windows**: time windows where the original baseline accepted-trade ledger had no baseline position and no same-timestamp baseline accepted entry. This idle-window qualification is already encoded in the 63-row evidence.

Therefore, during historical parity replay, do **not** re-apply a second dynamic “current integrated baseline open positions must be zero” gate against a path that has already diverged because of prior Idle trades. Doing so changes the experiment and produces the observed incorrect 51/63 result.

## 3. Exact 63 -> 61 cause

The two excluded candidates are now deterministically identified. They are rejected by **Idle same-symbol position occupancy**, not by future PnL and not by baseline Gross:

1. DOTUSDT candidate
   - t = 1780318800000
   - route = DOT_MOMENTUM_SHORT_BTCREL
   - hold = 24h
   - target_net = +0.0102749349522984
   - blocked because prior DOTUSDT Idle entry at t=1780246800000 was still open until t=1780333200000.

2. TIAUSDT candidate
   - t = 1784250000000
   - route = TIA_BREAKDOWN_SHORT_VOLCAP100
   - hold = 24h
   - target_net = +0.0673974038941588
   - blocked because prior TIAUSDT Idle entry at t=1784206800000 was still open until t=1784293200000.

Apply scheduled Idle exits before new Idle entries at the same timestamp. With one active Idle position per symbol, the canonical 63 rows deterministically become:
- admitted = 61
- rejected = 2
- wins = 48
- losses = 13
- DOT 14 / JUP 14 / RENDER 15 / TAO 9 / TIA 9

No outcome-based selector is involved.

## 4. Correct historical integrated replay

To reproduce the original JPY268.05M research experiment:

1. Start from the canonical **1284 accepted baseline trades** from the JPY141.845M run.
2. Preserve their original accepted entry schedule, planned exits, route metadata, requested gross, and original priority ordering.
3. Do not feed all previously rejected baseline candidate decisions back into the allocator. In particular, a baseline candidate rejected in the baseline-only run must not become a newly promoted trade because an earlier Idle trade changed actual-path slot/cooldown/capacity state.
4. Apply the 63 prequalified Idle candidates.
5. Apply Idle same-symbol occupancy; this yields the exact 61 rows above.
6. At an Idle candidate timestamp, the historical baseline-only idle mask is authoritative for eligibility. Do not re-reject an already prequalified Idle row merely because the integrated path now contains a baseline position that would not exist in the frozen baseline accepted-trade path.
7. Once an Idle position is open, include its exposure in the actual shared Gross calculation for **later baseline accepted trade intents**.
8. Later baseline accepted trade intents may therefore be rejected by shared capacity. Do not force-close/preempt the already-open Idle position.
9. Do not promote any baseline-only rejected candidate as a replacement.
10. Recompute wallet, funding, fees, FX translation, MTM equity, compounding, PF, DD, monthly equity and strategy attribution chronologically.

The old combined acceptance bundle is no longer valid. Cost/replay reconciliation proves the coherent fixed-intent overlays both retain 1,278 baseline trades and 61 Idle trades, for 1,339 total:
- 10bps: approximately JPY214.78M / PF 2.04643 / diagnostic hourly DD -22.84%
- 8bps sensitivity: approximately JPY268.15M / PF 2.09255 / diagnostic hourly DD -22.69%

The historical 1,342 count and JPY268.05M-as-10bps target must not be forced. The exact six baseline rejects are documented in the controlling cost/replay correction.

## 5. Why the 51/63 replay is not the historical experiment

A replay that:
- starts with all baseline candidate decisions,
- lets prior Idle fills change baseline slot/cooldown/admission state,
- promotes baseline candidates that were rejected in the baseline-only run,
- then re-tests each later Idle candidate against this newly diverged integrated state

is a **new counterfactual integrated strategy**, not the historical JPY268.05M overlay BT.

The reported diagnostic result:
- Idle accepted 51
- 12 x IDLE:NO_FULL_GROSS
- total trades 1331
- final JPY187.48M

is useful as a new-strategy diagnostic but must not be used to invalidate or redefine the historical overlay anchor.

## 6. Production implication

Do not blindly translate the frozen historical overlay into LIVE by using a static list of dates. Production must remain causal.

Before LIVE activation, Codex must first prove the corrected historical overlay parity. After that, the production design must use a **shadow baseline-only admission state** if required to preserve the historical meaning of “baseline idle” without future knowledge. The actual live portfolio remains subject to real Shared Risk / Margin Guard / Kill Switch / account lock / pending registry / venue margin checks; no cap may be silently bypassed.

If a causal production equivalent cannot preserve both:
- the historical baseline-only idle-window definition, and
- real current shared-cap safety,

remain fail-closed and report the exact divergence. Do not retune thresholds or use outcome-based exclusions.

## 7. Required next Codex action

Run one diagnostic before any Production mutation:

**FIXED_BASELINE_LEDGER_OVERLAY_REPLAY**

Inputs:
- canonical 1284 accepted baseline trade ledger
- canonical 63 Idle rows
- exact Aster H1/funding and ECB FX from the Release

Acceptance:
- exact same-symbol exclusions at DOT 1780318800000 and TIA 1784250000000
- 61 Idle / 48W13L
- identify the six later baseline accepted-trade intents rejected under the coherent 10bps dynamic-Gross overlay
- total 1,339 closed trades
- reproduce the coherent 10bps cost/replay reference and separately report the 8bps sensitivity

Only after this passes should Production adapter work resume.
