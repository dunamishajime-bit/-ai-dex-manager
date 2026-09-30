> **2026-09-30 cost/replay correction:** `docs/implementation/IDLE_PRIORITY_COST_RECONCILIATION_20260930.md` controls economic parity. The historical JPY268.05M / 1,342 bundle is not a coherent single 10bps run and must not be used as a Production/LIVE acceptance target. Primary coherent 10bps reference: 61 Idle, 1,339 total trades, ~JPY214.78M.

# Idle Priority SHORT evidence manifest

This directory documents the immutable research evidence required by the production handoff.

## Candidate stream
- idle_candidate_events.csv
- rows: 495
- bytes: 149207
- SHA256: 09e97db7a812728f5e54c1179c8e39ac30c6dba4fea241a9d415fa4810f8adbb

## Filtered route evidence
- idle_candidate_filtered.csv
- rows: 63
- bytes: 22234
- SHA256: 5029baad39bd07c9fc40ec4ba75941cb089697d5cebc437c29838cbc924f3e48
- DOT 15 / JUP 14 / RENDER 15 / TAO 9 / TIA 10

The CSV payloads are intentionally not invented or regenerated in Git. Validators require the exact external evidence bytes.

## Integrated acceptance anchors
- admitted Idle trades: 61
- TAO 9 (8W/1L)
- DOT 14 (11W/3L)
- JUP 14 (11W/3L)
- TIA 9 (7W/2L)
- RENDER 15 (11W/4L)
- total 48W/13L
- controlling baseline: approximately JPY141.85M / 1,284 closed trades
- coherent 10bps integrated reference: approximately JPY214.78M / 1,339 closed trades; 8bps sensitivity approximately JPY268.15M / 1,339 trades
- max MTM DD approximately -23.24%

A nearby 2026-09-28 10bps replay at JPY130,287,867 / 1,046 trades is not the controlling baseline and must not be substituted.

Use the candidate evidence validators first, then `scripts/idle-priority-short-integrated-parity.ts` against the rebuilt integrated ledger. LIVE activation is prohibited unless all handoff gates pass.
