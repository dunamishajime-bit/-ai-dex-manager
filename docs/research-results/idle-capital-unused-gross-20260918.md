# DisDex idle-capital / unused-gross research backtest

Status: **PASS_RESEARCH_ONLY**

Research-only. No LIVE/VPS/production state or services were changed and no orders were sent.

The CURRENT row is the exact formal anchor. Higher-target rows are explicitly marked projections: they replay only recovered realized candidate net returns at causal allocated gross; no synthetic price path, lookahead, or accepted uplift claim is used.

## CURRENT parity

- Formal event-level gate: **PASS**.
- NORMAL: asset 69,373,656.13931108; PF 3.70258068; DD -17.59935397%; trades 1165; V12 874; PENGU 66; Q102 69; V52 events 143.
- SEVERE: asset 8,729,157.74295382; PF 2.62470185; DD -19.24473938%; trades 1023; V12 871; PENGU 66; Q102 69; V52 events 0.
- The 90 Q102 candidates are causally routed to 69; no manual truncation is used. The 21 excluded rows are outside the period or blocked by a higher-priority core entry.

## Dynamic residual allocation

Core sleeves retain priority. Q102 is one-slot, lower-priority overlay capacity; REQUIRED_ONLY_PREEMPTION trims only the exact gross deficit at a later core entry.

| Mode | Target | Policy | Asset | PF | DD | Trades | Avg crypto gross | Unused crypto gross-hours | Utilization | Trims / gross | Latches | Core parity | Conflicts |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| NORMAL | 1.5 | CURRENT / CURRENT | 69373656.13931108 | 3.70258068 | -17.59935397% | 1165 | 0.661172 | 20488.13 | 22.04% | 13 / 15.168635 | 0 | PASS | 0 |
| NORMAL | 1.5 | RESERVE_0P5_REQUIRED_ONLY_1.5 / RESERVE_0P5_REQUIRED_ONLY | 34660970.44949293 | 4.31667410 | -17.59935397% | 1166 | 0.578800 | 21209.71 | 19.29% | 14 / 6.310954 | 0 | PASS | 0 |
| NORMAL | 2.0 | REQUIRED_ONLY_PREEMPTION_2 / REQUIRED_ONLY_PREEMPTION | 112693166.97872186 | 4.13915119 | -17.59935397% | 1204 | 0.725655 | 19923.26 | 24.19% | 52 / 28.672415 | 0 | PASS | 0 |
| NORMAL | 2.0 | RESERVE_0P5_REQUIRED_ONLY_2 / RESERVE_0P5_REQUIRED_ONLY | 69373656.13931108 | 4.24074293 | -17.59935397% | 1188 | 0.661172 | 20488.13 | 22.04% | 36 / 15.168635 | 0 | PASS | 0 |
| NORMAL | 2.5 | REQUIRED_ONLY_PREEMPTION_2.5 / REQUIRED_ONLY_PREEMPTION | 160150796.74069664 | 3.99776530 | -17.59935397% | 1248 | 0.778177 | 19463.17 | 25.94% | 96 / 47.721163 | 0 | PASS | 0 |
| NORMAL | 2.5 | RESERVE_0P5_REQUIRED_ONLY_2.5 / RESERVE_0P5_REQUIRED_ONLY | 112693166.97872186 | 4.13915119 | -17.59935397% | 1204 | 0.725655 | 19923.26 | 24.19% | 52 / 28.672415 | 0 | PASS | 0 |
| NORMAL | 3.0 | REQUIRED_ONLY_PREEMPTION_3 / REQUIRED_ONLY_PREEMPTION | 219120176.64318189 | 3.96033639 | -17.59935397% | 1266 | 0.818124 | 19113.24 | 27.27% | 114 / 72.138132 | 0 | PASS | 0 |
| NORMAL | 3.0 | RESERVE_0P5_REQUIRED_ONLY_3 / RESERVE_0P5_REQUIRED_ONLY | 160150796.74069664 | 3.99776530 | -17.59935397% | 1248 | 0.778177 | 19463.17 | 25.94% | 96 / 47.721163 | 0 | PASS | 0 |
| SEVERE | 1.5 | CURRENT / CURRENT | 8729157.74295382 | 2.62470185 | -19.24473938% | 1023 | 0.660685 | 20492.40 | 22.02% | 17 / 15.167281 | 1 | PASS | 0 |
| SEVERE | 1.5 | RESERVE_0P5_REQUIRED_ONLY_1.5 / RESERVE_0P5_REQUIRED_ONLY | 4501043.42916381 | 4.14223578 | -19.24473938% | 1020 | 0.578305 | 21214.05 | 19.28% | 14 / 6.311532 | 1 | PASS | 0 |
| SEVERE | 2.0 | REQUIRED_ONLY_PREEMPTION_2 / REQUIRED_ONLY_PREEMPTION | 13805279.53170464 | 3.96923329 | -19.24473938% | 1058 | 0.725170 | 19927.51 | 24.17% | 52 / 28.670043 | 1 | PASS | 0 |
| SEVERE | 2.0 | RESERVE_0P5_REQUIRED_ONLY_2 / RESERVE_0P5_REQUIRED_ONLY | 8729157.74295382 | 4.06997890 | -19.24473938% | 1042 | 0.660685 | 20492.40 | 22.02% | 36 / 15.167281 | 1 | PASS | 0 |
| SEVERE | 2.5 | REQUIRED_ONLY_PREEMPTION_2.5 / REQUIRED_ONLY_PREEMPTION | 19184736.70864876 | 3.83311810 | -19.24473938% | 1102 | 0.777694 | 19467.40 | 25.92% | 96 / 47.718444 | 1 | PASS | 0 |
| SEVERE | 2.5 | RESERVE_0P5_REQUIRED_ONLY_2.5 / RESERVE_0P5_REQUIRED_ONLY | 13805279.53170464 | 3.96923329 | -19.24473938% | 1058 | 0.725170 | 19927.51 | 24.17% | 52 / 28.670043 | 1 | PASS | 0 |
| SEVERE | 3.0 | REQUIRED_ONLY_PREEMPTION_3 / REQUIRED_ONLY_PREEMPTION | 25796261.97344840 | 3.79982498 | -19.24473938% | 1120 | 0.817640 | 19117.47 | 27.25% | 114 / 72.135205 | 1 | PASS | 0 |
| SEVERE | 3.0 | RESERVE_0P5_REQUIRED_ONLY_3 / RESERVE_0P5_REQUIRED_ONLY | 19184736.70864876 | 3.83311810 | -19.24473938% | 1102 | 0.777694 | 19467.40 | 25.92% | 96 / 47.718444 | 1 | PASS | 0 |

## Rejected claims

- ~162.72M (invalid; rejected and not used).
- The old 102-row frozen Q102 fixture is rejected by the lineage gate.

## Input hashes

- `formalJson`: `0d0425f571f7b7b8781be1260a625b404b5d1893ac355e60047205a270a0dff9`
- `v12Ledger`: `c3bb3ad341692aa2e9a987e10e1371da21564f8d848782ea3f0823d0a29b0b7c`
- `penguLedger`: `8b2a267249d8952e11252329a8329d9b22255c8c9a25b672698d9f02215a3663`
- `q102Candidates`: `832f9a723fbb95b8a57201f67e51687bb07b33120851940328de1b3ba0e9567b`
- `q102Evidence`: `41611bf8ad1a63f79a398befced551feb9aea2d9095008843b6049eae29d5f18`
- `stockBackbone`: `692f2194c026698feab115642301d9009db34fb9167cdfc232418aa1352a6ed3`
