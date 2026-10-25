# Dynamic score/GROSS replay parity and source-coverage audit (2026-10-25)

RESEARCH ONLY. No Production release, VPS, orders, or STOP changed. Source branch parent SHA:
20e1fa1ffa19685c24681ebdc5854faa17364c4b.

## Evidence and corrections

- Historical V12 scores observed in the recovered archive span 0.057..3.959,
  whereas the FET score spans 62.8..100 and uncalibrated other strategies used 50.
  Direct addition/comparison was invalid. Recovered V12 scores are now normalized
  as causal percentiles using only earlier signal timestamps, with named cold-start.
  This is experimental research calibration, NOT production model certification.
- Within one H1 timestamp candidate hard gating now sorts by comparable scored
  priority, not arbitrary fixed strategy ordering. Hard slot, risk, pending,
  min-notional, per-strategy and global gross caps are not increased.
  Unknown strategy caps fail closed.
- Live candidate validation rejects nonfinite or out-of-range market fit, and
  source-labeled uncalibrated raw V12 values <=4. Raw Idle return-magnitude scores
  use neutral 50 until a separately certified calibrated model exists.
- The registered source-coverage auditor fails closed on missing HYPE / Idle
  and mismatched latest V4 source SHA or missing V4 route identities.

## Recomputed 2025-08-10 to 2026-08-10 H1 price-model BT

This is FIVE strategy families only (V12, PENGU, Q102, FET, V52); starting
JPY10,000 + 13 monthly JPY10,000, PENGU hard cap 0.75x.

Baseline 10bps: JPY 86,226,900.11969732; DD -18.953073%; PF 2.063526; 1,316 trades.
Corrected dynamic 10bps: JPY 58,689,204.01167463; DD -17.139324%; PF 2.161358; 1,373 trades.
Baseline 30bps: JPY 10,525,810.354404999; DD -27.398184%; PF 1.657600; 1,316 trades.
Corrected dynamic 30bps: JPY 8,166,758.147083449; DD -24.515537%; PF 1.707098; 1,373 trades.

On the owner Windows PC, outputs are at:
C:\Users\dis\Desktop\DisDex_AI_Files\01_BT_Research\2026-10-25_dynamic-score-allocation-score-scale-fixed-research

The corrected dynamic allocator still loses material final equity and remains UNADOPTED.

## Why full latest integrated BT is not certified

Source coverage audit fails:
- Canonical annual HYPE candidate/exit tape is missing.
- Canonical annual Idle candidate/exit tape is missing.
- ZEC is conservatively required as an eighth owner until current owner roster verifies its activation; no corresponding annual candidate tape is present.
- All 1,071 accepted V12 modeled trades have no V4 route identity.
- All 1,071 V12 modeled trades cite old source dbf84542311c15f69508f91a0e7311ff7e686d96,
  not current V4 service 23ddd4b01fcff38cd10d4d4614221f93dc6b44e5.
- No independent score-prior holdout or L2 execution fill tape.

The historical source predates the latest adopted V4/Q102/PENGU/HYPE/Idle
entry and exit changes and CANNOT be called latest all-logic economic BT.
The all-owner inventory (including whether ZEC is a separate owner) must
be fixed from production evidence before claiming exact coverage.
Do not fabricate missing candidates, trades, fills or strategy exits.

Next: rebuild all causal annual candidate and exit tapes from the exact
currently adopted source lineage, verify 41 V4 routes and each other
strategy, then rerun 10/30bps with real same-time competing candidates,
pending positions/orders, gross/venue margin/STOP and allocation quality.
Publish route-level DD, trade count, PF, win rate and residual utilization.
No automatic dynamic LIVE order enablement before parity certification.
