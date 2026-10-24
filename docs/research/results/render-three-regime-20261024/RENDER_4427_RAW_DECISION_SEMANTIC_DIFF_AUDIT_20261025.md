# RENDER #4427 raw decision semantic diff audit (2026-10-25)

STATUS: RESEARCH ONLY; not eligible for adoption.

## 10bps
- 3 raw decision files: [2543, 2523, 2523] rows; first run alone has 20 V12 adverse-side cooldown rejections.
- After removing only those 20 rejected rows and identity fields ['candidate_id', 'event_seq', 'owner_candidate_id'], all 2523 remaining candidate decisions match exactly in all 3 runs.
- Semantic decision SHA256: db776e2080a6fc73a73e29152ef6ff7468e35af714cd3fe65577ceb7ecd040e9
- Accepted entries per run: 1293. New RENDER accepted gross: [{'entry_ts_ms': 1782176400000, 'requested': 0.25, 'accepted': 0.22275389599297446}, {'entry_ts_ms': 1782370800000, 'requested': 0.25, 'accepted': 0.21255926278847206}].

## 30bps
- 3 raw decision files: [2543, 2523, 2523] rows; first run alone has 20 V12 adverse-side cooldown rejections.
- After removing only those 20 rejected rows and identity fields ['candidate_id', 'event_seq', 'owner_candidate_id'], all 2523 remaining candidate decisions match exactly in all 3 runs.
- Semantic decision SHA256: 89672c8b4221b36f49d74d1d9a635e30d04a9c86985c47b6a8b003e0759c06b3
- Accepted entries per run: 1292. New RENDER accepted gross: [{'entry_ts_ms': 1782176400000, 'requested': 0.25, 'accepted': 0.24999985769906155}, {'entry_ts_ms': 1782370800000, 'requested': 0.25, 'accepted': 0.24999982448271585}].

## Decision
The only remaining semantic candidate-row discrepancy among the 3 runs is the presence of 20 first-run-only rejected V12 cooldown rows. No accepted candidate decision differs after identity normalization. This does not fix raw decision determinism and does not establish the source of the cold/warm discrepancy.

Formal Owner/Route, all risk-gate parity, 2025 Aster H1 mark, venue fills and funding remain unverified. No production changes.
