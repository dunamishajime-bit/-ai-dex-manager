# STABLE3 reproducibility ledger - 2026-11-13

Status: RESEARCH ONLY / NO PRODUCTION MUTATION

Locked baseline: 2025-10-01 00:00 UTC <= t < 2026-10-01 00:00 UTC; initial JPY 10,000.
Source commit: b7133c209ad9e2f59b9b37d032bb1b3379258267

Expected exact results:
10bps: JPY 4512970.171211586 / DD -26.05877304176173% / fills 856 / WR 61.6822429906542% / PF 1.668352713023249 / intents 2466
30bps: JPY 1454529.574075996 / DD -28.076361286367945% / fills 855 / WR 59.53216374269006% / PF 1.512646047959108 / intents 2466

One-command replay:
PowerShell: & '
C:\tmp\disdex-bt-20251001-20261001\REUSABLE_STABLE3_REPRO_20261113_V1
\RUN_STABLE3_REPRO.ps1'

Frozen route quarantines: PENGU SHORT_V20; Q102 AVAX MR24_Z1.5_H24; Q102 UNI MR72_Z1.5_H24.

Recovered source scripts are from the GitHub commit above. Input/source SHA256 values are stored in STABLE3_REPRO_MANIFEST_20261113_V1.json.
The 2026-11-13 full replay reproduced both locked baselines exactly.
