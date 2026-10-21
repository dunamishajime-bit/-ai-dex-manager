# V12 V4 LONG: after +2% MFE, set protective emergency STOP to -5% of entry

> RESEARCH ONLY / NOT LIVE / full8 allocator BT verified. User-proposed risk control.

## Policy meaning

- Entry 100, unrealized gain first reaches 102 (+2%), then tighten loss STOP from current 92 (-8%) to 95 (-5%). The extra 3 percentage points of risk relief do not represent a protected gain: from 102 to 95 is a 7-point fall.
- Continue the user-selected +3% MFE, +1% giveback, **two completed bearish H1 closes** rule. A H1-confirmed market exit can slip below +1%; it is not a guaranteed profit floor.
- Research assumes resident-like 5m STOP armed using a prior 5m bar high, fills conservatively at the worse of stop and adverse gap open. No same-bar hindsight, no actual signed exchange fill.

## Completed 8-logic integrated BT, 2025-08-10 to 2026-08-10, initial JPY 10,000, zero top-ups

| Variant | Final 10bps | Final 30bps | 10bps change vs user-selected +3/+1 | 30bps change vs selected | MaxDD change 10bps | MaxDD change 30bps | Original losing trades improved (10bps) | Original winners exited early (10bps) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| X3_AFTER2_STOP_MINUS5 | ¥222,373,711 | ¥123,696,117 | ¥+0 | ¥+0 | +0.00000pp | +0.00000pp | 0 | 1 |
| TIME37_AFTER2_STOP_MINUS5 | ¥216,725,170 | ¥115,339,340 | ¥-5,648,540 | ¥-8,356,778 | -0.00342pp | -0.02175pp | 0 | 8 |
| X3_AFTER2_STOP_MINUS4 | ¥222,873,279 | ¥121,415,902 | ¥+499,569 | ¥-2,280,215 | -0.00414pp | -0.03064pp | 0 | 2 |
| X3_AFTER2_STOP_MINUS6 | ¥222,373,711 | ¥123,696,117 | ¥+0 | ¥+0 | +0.00000pp | +0.00000pp | 0 | 1 |

## Recommendation

- **X09/X10/X14 only -5%: research/forward-shadow candidate.** 10/30bps combined portfolio final profits, PF and max DD remain exactly the same as the already selected +3/+1 H1 rule. Examination of accepted trade exit reasons found zero **additional accepted -5% M5 emergency exits** in this sample. Therefore this establishes **no demonstrated historical downside reduction**. It might help in a future unseen tail event; forward shadow should watch for candidate triggers and actual venue executable levels.
- All37 TIME routes -5%: no historic original losing trades salvaged and portfolio economic outcomes and DD worse than selected policy under both costs; **do not adopt**.
- X09/X10/X14 -4%: tempting 10bps equity gain but worsens 30bps profit and maximum DD; reject as unrobust. -6% same as -5% historically, weaker protection if triggered.
- Keep existing -8% emergency until a new per-leg arm marker, monotonic exact -5% STOP reprice, safe resident STOP replacement/restart reconciliation, signed venue order proof, runner/CI and independent Task9/LIVE parity are certified.
- The original worst full8 portfolio DD episode contains no V12 V4 LONG exposure. This individual-risk safeguard is not a demonstrated fix for portfolio max DD.

## Evidence

- Scenario code: scripts/dd-reduction/run-task9-v4-long-after2-stopminus5-20261021.py
- Causal tests: scripts/dd-reduction/test-v4-long-after2-stopminus5-20261021.py
- Evidence: V12_V4_LONG_AFTER_PLUS2_MINUS5_VERIFIED_BT_20261021.json
- Repeat SHA proof: V12_V4_LONG_PLUS2_TO_MINUS5_SHA_PROOF_20261021.json
- No VPS Production, runtime state, stop order, manual position, release, approval or deployment mutation.
