# Archived native full-eight: overlap-only Score allocation BT, 2026-10-25

## Exact experiment

User rule: Only activate Score-based residual GROSS distribution when
a DIFFERENT strategy already has a genuinely held nonzero position.
Otherwise preserve native admission, approved size, exit and STOP exactly.

Archived source: 2026-10-23 native full8 integrated model, not current
production eight-SHA certification. Eight owners: V12, PENGU, Q102,
FET, HYPE_LONG, IDLE, RESIDUAL, V52.
Period 2025-08-10 through 2026-08-10, initial JPY10,000, NO monthly
contributions, 10bps and 30bps separately, historical H1/5m native
event/mark/funding ledger.

The source-locked comparator only uses the postgate accepted native
trades as authorized orders. No new candidates, route/exit changes or
historical signals were manufactured. A true dynamic candidate reselection
cannot be certified from this archived postgate ledger alone.

## Result: score cannot enlarge a strict approved gross target

| Metric | 10bps baseline | 10bps conditional | 30bps baseline | 30bps conditional |
| --- | ---: | ---: | ---: | ---: |
| Final JPY | 247438945.47375035 | 247438945.47375044 | 144317986.6690193 | 144317986.66901922 |
| Closed trade count | 1298 | 1298 | 1286 | 1286 |
| DD | -14.603309760733396% | -14.603309760733396% | -15.778272357784107% | -15.778272357784107% |
| PF | 4.12540014478322 | 4.12540014478322 | 3.4774802591688587 | 3.4774802591688587 |
| Extra capital allocated through Score | 0 | 0 | 0 | 0 |

**Explanation:** the current TypeScript registry contracts Score
candidates to the native strict planner's approval.accepted.gross.
The dynamic allocator cannot exceed that approval. Thus, on the fixed
native-approved trade universe there is no additional GROSS that
can be assigned using Score. The baseline still has residual gross
at times, but new trades cannot be manufactured from it without
passing the native planner again.

Strict preexisting-other-strategy holding at *the moment of entry*,
excluding same-timestamp freshly filled orders and same-timestamp
already-closed positions:
- 10bps: 970 of 1298 accepted orders, 453 with requested > approved
  by more than 0.001 gross.
- 30bps: 954 of 1286 accepted orders, 421 requested > approved.
- 10bps: 115 same-time groups with more than one Score eligible
  candidate. 30bps: 112 such groups.
- New allocatable approved gross above the native approval:
  **ZERO** across both modeled portfolios.
- Native capacity or quantity rejected candidates while holding
  another strategy (NOT proven eligible to order): 137 (10bps),
  108 (30bps). Reasons include V12 no gross room and Idle/Residual
  full 1x quantity restrictions. Many cannot be fixed merely by
  a Score reordering; min-notional, venue/slot and other risk
  controls still apply.
- Historical native allocation headroom observed crypto up to
  3.5x and total up to 4.75x. A prior alternative BT erroneously
  enforced crypto 3.0x and total 4.25x, which dropped native trades.
  These archived 3.5x/4.75x caps are NOT certification of the
  currently deployed production limits.

The original historical native BT wallet, monthly contributions,
funding, partial exits, route identity, native entry and exit
events were verified exactly by:
scripts/audit_native_full8_source_locked_baseline.py

## Deterministic source-backed execution

scripts/research_overlap_only_native_approval_bt.py
recomputed both cost conditions twice, with byte-for-byte identical
research reports and 1298/1286 native accepted candidate audit rows.

10bps summary SHA256:
eae1029a4cb2a80ea7ede60de88d8ece4ba60bd3f8c1f62ad765d415b611214e
30bps summary SHA256:
6e13192287a880faa851845a661a980d85b97501729ca9fe35cb6b807853c20a

Research output folder on owner Windows PC:
C:\Users\dis\Desktop\DisDex_AI_Files\01_BT_Research\2026-10-25_overlap-only-score-native-approval-bt

## Mandatory next correct implementation / BT scope

Move the Score arbitration to *inside* the current native 8-owner
planner between strategy entry/ownership/STOP gates and final gross
acceptance, but ONLY activate when another strategy's position was
already held before the new signal. Do not score-reorder normal orders.

Use a signed fresh ledger of all simultaneously eligible native signals,
including candidates currently excluded only because of gross,
but REAPPLY current native gross, slot, cooldown, pending exposure,
venue min-lot, stop and shared-risk limits after any allocation.
Issue new strict approvals against the newly calculated quantities
before any live orders. Historical orders and exits then need a
native event-loop forward replay, with changing account/positions
and H1/5m marks and funding, on the SAME base native candidate set.

Only after re-running the exact currently adopted runner SHAs and
native ownership logic can final equity/PF/DD of a TRUE new dynamic
allocation be compared meaningfully. This report is NOT such an
all-eight latest-source completed economic comparison.

LIVE/Production was not switched; no open orders, positions, STOPs
or risk limits were touched.
