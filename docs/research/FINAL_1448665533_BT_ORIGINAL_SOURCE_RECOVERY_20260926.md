# Original Final Dynamic Gross 14.49億 BT — provenance recovery (2026-09-26)

**STATUS: PARTIAL_ORIGINAL_OUTPUT_RECOVERED / ORIGINAL_EXECUTABLE_ENGINE_NOT_FOUND**

Original reference is the **2026-09-22** archived Final LIVE Governor replay, **not** the 2026-09-20 FET1.25 740m case, and **not** any 2026-09-25/26 independent fresh/proxy engine. All probes here are READ ONLY; no Production/VPS order-state mutation.

## Recovered and SHA-pinned original outputs

1. Original committed research summary: `docs/research-results/final-live-governor-20260922.json`, introduced in commit `cd67a007c13c7ea7a51e0e9299dbeac5336e48e9`. Verified VPS copy `/home/deploy/disdex-trading/work/v12-winrate-gates-20260923/docs/research-results/final-live-governor-20260922.json`: SHA256 `f14079e54874934c6be0cae4c37272659ab22d5a1a035416ea424bb55227cd1d`, 15,150 bytes. NORMAL JPY 1,448,665,533.0239232 / PF 4.14112335 / max DD -19.61179353% / trades 1164. SEVERE JPY 75,982,803.52048858 / PF 3.01497717 / max DD -19.97886021% / trades 1020. These figures are **archived claims, NOT independently reproduced results**.
2. Recovered original VPS extended monthly intermediate `/tmp/final-monthly-fet.json`: SHA256 `763ee00c41f96ad3d0196c0488b1557d6c36946c266341af2c023aca54a4c6d3`, 32,098 bytes, both modes' 13 monthly equity records and 13 monthly per-sleeve `monthlyBreakdown` records, but **no complete trade/event ledger or generator code**. Preserved immutable GitHub Actions artifact: `original-14p49b-vps-temp-result-20260926` (artifact ID `10896068300`, run `36213147386`).
3. Historical Sept-21 Actions artifact `current-v12-top2-pengu-v20-v52-dca-35640770584` (artifact `10659015274`) contains `v12-top2-ledger.json` and `pengu-v20-ledger.json`, but **its period is 2025-08-01..2026-08-01**, not the 14.49億 anchor's 2025-08-10..2026-08-10, and it has no final Top3/FET/Q102/global allocator ledger. **Do not substitute** it.

## Original engine/source search actually performed

- GitHub pinned original production result commit `cd67a007...`, relevant Sep-19/20/22 research and production branches: result/contract/config/library found, **no original final 14.49億 BT generator** committed. Precursor source `scripts/research_latest_v8_quality102_grosssafe.py` and historical standalone/code-capture artifact `pengu-integrated-engine-capture` (run `35934170491`, artifact `10782815082`) exist but model an older V12 Top2/global gross setup, **not final 14.49億 exact parity**. The Sep-21 result commit's own BT Actions execution has **zero jobs**, not a reproducible completed BT.
- VPS full read-only filename/content inventory: **8,100 files** under 16 historical research/worktree/backups/temp roots. Exact result JSONs and the extended monthly intermediate recovered, but the earlier historical filename `research_v12_dynamic2_q102_brk2465_20260919.py` and a final 14.49億 generator absent. The associated Sep-19 file reference is a **predecessor research clue**, not verified as final 14.49億 executable.
- Examined **85 files in accessible VPS/OS backup directories** (mostly systemd and risk state, no original BT source), inspected 123 relevant `/tmp` files, listed available private research-state content (one 2026-09-23 V12 research result), searched old Git history and session markers. Git `fsck` scanned **47 unreachable local blobs** (39+8), **zero matching** code/result markers.
- GitHub Actions repository API inventory: **154 retained artifacts** dated 2026-09-17..24, **57 potentially relevant by name**. In the 2026-09-21 subset only the different-period Top2 artifact above was retained; none of the retained Sep-21/22 artifacts contains the exact full final 14.49億 engine. Current cache API exposes only **one unrelated USDM snapshot**, not the final research cache.

## Missing acceptance evidence (MUST NOT synthesize)

- The exact executable source/patch sequence that turned the precursor engine into `top3_q102gov030_fet2.25` with final live gross governor, 5x Cross margin cap, Dynamic V12, original PENGU Gross0.85, FET preemption, Q102 and V52.
- Exact all-sleeve trade/candidate/partial-event chronological ledger, original global gross/governor allocation event ordering, original frozen historical market/stock-cache hash, and original source/input manifest.
- Proof that executing that exact code with frozen inputs reproduces NORMAL JPY 1,448,665,533.0239232 and SEVERE JPY 75,982,803.52048858, including published PF/DD/trade counts.

**No new PENGU substitution BT shall be labeled verified before original baseline replay parity.** Do not use new 2026-09-25/26 proxy data/BT code; preserve genuine old outputs and segregate predecessor inputs.

### Read-only provenance runs
- VPS full worktree source scan: https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36212992268
- Hidden research-state and temp archive scan: https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36213077623
- Exact `/tmp/final-monthly-fet.json` SHA-verified preservation: https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36213147386
- VPS backup/Git orphan scan: https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36213328115
- GitHub Actions artifact/cache inventory: https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36213440316
