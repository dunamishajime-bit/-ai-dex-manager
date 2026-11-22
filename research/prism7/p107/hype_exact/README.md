# P107 HYPE current-source-native 1y signal and H48 boundary audit

Source immutable pin: e0e4f1d8f22b62e9410188ef6e590a20e31f760f. The source snapshots in source/ were extracted as unmodified git blobs and SHA256-verified.

Exact pinned TypeScript entry function evaluated over ASTER HYPEUSDT and BTCUSDT 1H at 6-hour grid asof entry time 2025-10-01 through 2026-10-01 UTC. Exact pinned H48 contract and H48 exit function validated each 48h logical boundary with price reference. Negative tests cover entry time, H1 gaps, corrupt H1, stale/mismatched H48 boundaries.

Results: 1460 grid observations, 35 HYPE entry candidates, 35 corresponding H48 reference opens, zero missing price boundaries. Legacy research had 78 candidates (only 8 on six-hour grid); none share entry timestamp with these 35. Old candidates cannot be passed off as current HYPE.

Not an account BT: 35 candidates not signed fills. H1 opens are historical price references not executable orderbook quotations. Portfolio, Shared Risk, order ownership, Gross, STOP, slippage and Funding unmodeled; no new permission for unprotected positions.

Tests / rerun: tsx hype_native_exact_replay.ts <HYPE H1 JSON path> <BTC H1 JSON path> <output JSON path>; tsx hype_native_contract_regression.ts <HYPE H1 JSON path> <BTC H1 JSON path>. Input SHA256 and source blob SHA256 are in companion manifest. HYPE current phase inactive on VPS read-only status audit; hypothetical candidate replay is not a live-run record.

No production, Runner, order, STOP or GLOBAL HOLD change.
