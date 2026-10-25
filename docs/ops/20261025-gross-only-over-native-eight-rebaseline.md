# 2026-10-25 — Correct strategy: overlay ONLY gross allocation on original full8 BT

Prior regenerated BT (JPY 78.76m / 799 trades, 10bps) is not a
valid base-vs-dynamic comparison: it replaced the native candidate
admission, ownership, priority and cooldown chain with approximations.
Do NOT cite it as an economic comparison to the previously accepted BT.

The immutable previous native full8 baseline was recovered from the
2026-10-23 archived residual-ablation research run. Eight strategy
families: V12, PENGU, Q102, FET, HYPE_LONG, IDLE, RESIDUAL, V52.
Native admission, symbol/strategy ownership, actual portfolio venue
sizing, exit times, partial exits, funding, and source identifiers must
remain untouched for the baseline comparison. 2026-10-23 is a
HISTORICAL source lineage, not the latest active production runtime SHA.

Verified source-locked events using the new Python auditor:
- 10bps: 1298 accepted, 1298 closed, original JPY 247438945.47375035
  = recomputed JPY 247438945.47375044; DD -14.60330976%,
  PF 4.125400; contribution JPY10000 only.
  4849 funding events, 5 partial exit events, 7451 wallet checkpoints,
  zero per-event errors.
- 30bps: 1286 accepted, 1286 closed, original JPY 144317986.6690193
  = recomputed JPY 144317986.66901922; DD -15.77827236%,
  PF 3.47748; contribution JPY10000 only.
  4863 funding events, 6 partial exit events, 7442 wallet checkpoints,
  zero per-event errors.
- Both event streams match every native event wallet checkpoint and
  the published final JPY equity to floating point precision.

The 2026-10-25 dynamic replay used JPY10000 plus monthly JPY10000,
different native owner gates, PENGU 0.75x hard cap, and altered native
candidate adoption. The real native original 2026-10-23 source uses
initial JPY10000 and NO monthly additions and native sizing including
PENGU up to ~1x. These differences invalidate its economic comparison.

The allowed economic modification is *only* the post-native-gate
approved_gross_at_entry (new size), without changing native entry/exit
or signal classification. Mandatory consequence: recalculate partial
fills, stops, funding, fees, realized cashflows, new H1 MTM, DD, and
all shared/position/strategy/margin/venue constraints with that quantity.
A frozen native accepted cohort alone CANNOT discover additional trades
that originally failed gross constraints; adding those requires executing
the same NATIVE gating code on the same timestamp after a different
allocation. NEVER infer eligibility from capital availability alone.

Latest exact full8 economic dynamic-versus-native BT is NOT COMPLETE.
No gross overlay was applied by the baseline auditor. It proves the
original is now an immutable, reproducible comparison anchor.
Native entry/exit engine source that generated every Oct23 admission
has not been recovered or revalidated against the current production SHA.
The archive includes old dbf845 / ce1edee source identifiers.

Evidence on owner PC:
C:\Users\dis\Desktop\DisDex_AI_Files\01_BT_Research\2026-10-25_native-eight-locked-gross-only-baseline
GROSS-only source-lock auditor:
scripts/audit_native_full8_source_locked_baseline.py

Next: locate/rebuild native full8 original source+postgate sizing hook,
run identity mode at precisely native 10bps and 30bps for all fields,
then apply the common dynamic allocator ONLY inside that hook.
Do not deploy to VPS until strict production code-source parity and
original native baseline are both proven.

## Native GROSS-only locked-cohort counterfactual result

An additional experimental quantity-only replayer is included:
scripts/research_native_full8_frozen_cohort_gross_shadow.py .
It copies all 1298/1286 native selected entry and exit timestamps and
uses only already closed strategies for causal prior ranking, then sizes
these entries using research gross limits. This is a NON-FORMAL shadow:
no original native postgate re-selection is performed. The replayer
correctly FAILS CLOSED rather than reporting invalid equity:
- 10bps: 35 original accepted entries have no remaining executable
  gross after alternative prior sizes.
- 30bps: 34 such accepted entries.
A shadow process retaining their old exits/accepted status would
manufacture economically impossible trades, so the output final-equity
field is null, with status:
BLOCKED_NATIVE_LOCKED_COHORT_INFEASIBLE_AFTER_GROSS_CHANGE.
This is NOT proof that dynamic distribution decreases equity:
it proves native gate/owner/margin state must be rerun after every
modified gross allocation while ENTRY SIGNAL RULES stay unchanged.
A gross-only sensitivity with a frozen cohort cannot replace the
full native event loop when capacity allocation affects later eligibility.
