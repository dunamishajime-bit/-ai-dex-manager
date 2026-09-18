# DisDex idle-capital / unused-gross research backtest

Status: **PASS_RESEARCH_ONLY**

Research-only. No LIVE/VPS/production state or services were changed and no orders were sent.

Methodology: FULL EVENT REPLAY. Every target is a separate run of the reconstructed formal simulator with exact Q102 MTM preemption; no factor scaling, approximate PF/DD, synthetic price path, or lookahead is used.

## CURRENT parity

- Formal event-level gate: **PASS**.
- Target 1.5 is the authoritative formal CURRENT anchor.
- Every target preserves V12/PENGU/V50/Q102 core fills and reports zero gross conflicts before it is included.

## Required-only preemption targets

| Mode | Target | Asset | PF | DD | Trades | Avg crypto gross | Crypto gross-hours | Unused gross-hours | Utilization | Trims | Trimmed notional JPY | Released gross equivalent | DD flag |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| NORMAL | 1.5 | 69373656.13931108 | 3.70258068 | -17.59935397% | 1165 | 0.70193816 | 6148.97830683 | 20131.02169317 | 23.39793876% | 13 | 29533730.81218776 | 3.73300455 | — |
| SEVERE | 1.5 | 8729157.74295382 | 2.62470185 | -19.24473938% | 1023 | 0.70698567 | 6193.19442853 | 20086.80557147 | 23.56618885% | 17 | 5874336.99699522 | 2.30818871 | — |
| NORMAL | 2.0 | 128760885.56313150 | 3.71625945 | -22.79731120% | 1197 | 0.77165970 | 6759.73901357 | 19520.26098643 | 25.72199016% | 45 | 208972078.77157372 | 14.80156094 | FLAG >20% |
| SEVERE | 2.0 | 15480956.76680395 | 2.69200450 | -23.70403259% | 1048 | 0.77892752 | 6823.40503159 | 19456.59496841 | 25.96425050% | 42 | 43468120.44211683 | 12.34465319 | FLAG >20% |
| NORMAL | 2.5 | 209152547.18258882 | 3.67732802 | -27.96929818% | 1244 | 0.82750486 | 7248.94259216 | 19031.05740784 | 27.58349540% | 92 | 743361821.53665268 | 32.42326154 | FLAG >20% |
| SEVERE | 2.5 | 24282260.37897472 | 2.70771839 | -28.88667180% | 1099 | 0.83663469 | 7328.91986815 | 18951.08013185 | 27.88782294% | 93 | 144166175.63295323 | 29.18926243 | FLAG >20% |
| NORMAL | 3.0 | 315968224.48873270 | 3.62645640 | -33.08113860% | 1260 | 0.86739334 | 7598.36570082 | 18681.63429918 | 28.91311149% | 108 | 2018046217.17135549 | 56.21153110 | FLAG >20% |
| SEVERE | 3.0 | 37831721.45713750 | 2.73295146 | -34.04566958% | 1106 | 0.88449975 | 7748.21779999 | 18531.78220001 | 29.48332496% | 100 | 375110904.55905741 | 50.96846237 | FLAG >20% |

Target 2.0 and above exceed 20% drawdown in both modes; they are flagged research comparisons and are not recommendations.
Released gross equivalent is defined consistently as the sum of each exact MTM trim's `trimmedNotionalJpy / postTrimEquityJpy`.

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
- `stockCache`: `29d15ba7b5310ab78474914b9f576f401b47048838b9201881d6ed3f0b7b74f0`
- `canonicalRunner`: `566cadd906cc967a26bd6a71fe56e1bf37fd1b7c68cc112b7569fdb47b09745e`
