# P107 follow-up: official Binance FET backfill and V52 source readiness, 2026-11-23

## FET

Official Binance USD-M FETUSDT 1h archive for March 2025–January 2026: 11 monthly ZIPs, all 11 official SHA256 checksums verified, 8,088 hourly bars, no gaps. ASTER public FET history starts 2026-01-09 18:00 UTC. The source-tagged research-only hybrid combines 7,554 earlier Binance hours with 6,342 later ASTER hours for 13,896 contiguous bars. There were 534 overlapping venue hours; median absolute close difference 0.354%, p95 1.982%, maximum 4.148%.

Exact pinned FET source 7688ed7c... using hybrid indicators yields 17 raw signals instead of 11; all six additional signals occur *before* the first ASTER FET candle, and must be marked ASTER_NOT_EXECUTABLE. 11 later ASTER native candidates match the archived 11 exactly, including features. No fictitious ASTER fills or price substitution. Current pinned Q102 c7310d34... replay with this substituted FET indicator data still has 499 eligible out of 2,190 grids and 49 identical raw candidates; other symbol history (LDO/RENDER etc.) keeps the full universe fail-closed in earlier periods.

## V52

Read-only VPS unit inspection confirms current SHA c7310d34... V52 service active/running; older units inactive. This does NOT establish the order authority or historical signed execution. Current native source requires ASTER bid/ask/mid, spread, orderbook depth, source receipt time, reference quote receipt time, basis and cost/slippage plus NY session and AMZN Short Yahoo source guard. Stock source limits 4.0x total stock, 2.0x per stock slot; integrated policy source total gross 4.25x. Historical Yahoo H1 exists for five stocks, but verified synchronized ASTER book and reference quote timeline is still missing. The archived 10bps/30bps model has 87 V52 price-proxy rows each, 0 signed fills, all V52_H1_BASIS_PRICE_ONLY (META24 TSLA20 AMZN17 MSFT17 NVDA9). No claim of V52 native parity. Six native AMZN Yahoo gate tests PASS.

## P107 status

Full P107 current-production-exact STABLE4 portfolio baseline is **BLOCKED_NOT_FULL_PARITY** because order permission, chronology of position ownership, V52 native execution, exchange book/quote provenance, STOP/funding and Shared Risk/Gross remain incomplete. Preserve P107→P108→P109→P110 order. V52 is an outstanding accounting lane and must NOT be silently dropped. No production changes or venue orders.

Sources: [FET venue attribution and raw source attestations](./fet_binance_backfill/README.md), [V52 native input gap](./v52_exact/README.md), [six native runner signal registry](./integrated_candidates/README.md).
