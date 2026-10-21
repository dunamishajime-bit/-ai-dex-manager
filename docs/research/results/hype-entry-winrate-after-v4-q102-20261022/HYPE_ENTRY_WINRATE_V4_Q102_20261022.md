# HYPE entry win-rate improvement — fixed V12 V4 + Q102 (2026-10-22)

> RESEARCH only. Seven already user-adopted exit improvements (V4 four, Q102 three) kept unchanged, no Production or venue changes.

Historical 2025-08-10..2026-08-10; JPY10k compounded, zero deposits; 10bps and 30bps; eight-logic chronological dynamic allocator.

HYPE original 10bps 12 wins / 40 = 30%; 30bps 13 wins / 38 = 34.2%. The five exit-protection variants were inferior; focus on avoiding weak entries.

## Pre-entry causal technical features

BTC3h% = (most recent fully COMPLETED M5 BTC close / its close 3h earlier - 1) ×100.
HYPE3h% same definition; relative3h% = HYPE3h% minus BTC3h% in *percentage points*.
No current incomplete M5/H1 candle; HYPE candidates vetoed only before actual historical allocation, so other symbols can be reselected.
Unseen 2026-08 onward prices are NOT covered; the chronological 70/30 screen was inspected during selection and therefore NOT a fresh out-of-sample certification.

## Integrated 8-logic economics versus accepted-seven baseline

| HYPE entry filter | HYPE W/N 10bps | JPY 10bps | DD 10bps | HYPE W/N 30bps | JPY 30bps | DD 30bps |
|---|---:|---:|---:|---:|---:|---:|
| HYPE_BTC3H_LE0P6 | 12/23 (52.2%) | ¥229,913,264 | -14.60331% | 11/21 (52.4%) | ¥125,796,884 | -15.80771% |
| HYPE_REL3H_GE3P0 | 8/16 (50.0%) | ¥217,743,794 | -14.60331% | 8/15 (53.3%) | ¥102,693,847 | -15.81146% |
| HYPE_BTC3H_LE0P8_REL3H_GE2P0 | 12/20 (60.0%) | ¥238,941,721 | -14.60331% | 12/19 (63.2%) | ¥136,460,250 | -15.80771% |
| HYPE_BTC3H_LE0P6_REL3H_GE2P0 | 12/18 (66.7%) | ¥244,636,193 | -14.60331% | 12/17 (70.6%) | ¥140,458,102 | -15.80771% |

Original seven-adopted baseline: 10bps ¥198,324,735, DD -14.60331%; 30bps ¥88,431,931, DD -15.75383%.

## Validations & interpretation

- All modeled CLOSED HYPE trades under each gate have the exact causal pre-entry BTC/HYPE 3h feature signature. No winner/loser label enters decisions.
- Test code asserts completed M5 no-lookahead, fail-closed missing window, unchanged other strategies.
- Accepted V4 SHORT same-symbol admitted-STOP cooldown replays converge. Last two 8-logic candidate decisions, trades, events, MTM and metrics ledgers: 40/40 SHA256 match.
- WARNING: In raw experimental diagnostics, candidateHypePassed/Blocked sets deduplicate unassigned proposal candidate_id=null and are NOT reliable unique veto counts. Audited accepted fills/returns, not these counters, are the source of truth.
- 30bps stress DD can deteriorate slightly even when normal 10bps DD unchanged. Portfolio DD is an absolute risk preference.
- HYPE subset n~15–25: a high in-sample win rate does not imply future 70% probability. Independent forward shadow or unused prospective series required before making LIVE changes.
- Runtime implementation needs actual current HYPE75 signal source and matched venue-certified Order/STOP manager, not just historical regression.

Raw historical native engine outputs remain on owner PC; this commit includes research script, validation, hashed receipts and human summary.
