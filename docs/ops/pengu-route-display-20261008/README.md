# PENGU route display correction — 2026-10-08

The HP attributed a real PENGU SHORT entry to V64 Dynamic Long because its reason included the comparison text "SHORT_FIRST priority over V64 Dynamic Long/Recovery". The display parser now prioritizes explicit route evidence and recognizes the SHORT_FIRST reason as Short V20.

## Verified production entry

- Entry: 2026-10-08 05:00:22.600 UTC / 14:00:22.600 JST.
- Aster order: 1165455175; trade: 556873.
- Side: SELL / SHORT; quantity: 7,718 PENGU; entry price: 0.008574 USDT.
- Before: routeLabel V64 Dynamic Long.
- After: routeLabel Short V20, positionVerified true.
- Live portfolio confirmed SHORT 7,718 and a reduce-only BUY stop.
- No trading logic, orders, or position changes were made by this correction.

## Validation

Four new route regression tests and eleven related attribution/lineage tests passed locally. Independent review found no Critical or Important findings. Production deployment workflow passed its full UI tests, type checking, build, public smoke check, and trading immutability checks.

Deployment: https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/37758037563

Deployed UI commit: 8ed6610457c97c59b4b5d0203e37b2d03c202b9b
UI service active at ui-realtime-ranking-8ed6610457c9.
Trading release unchanged: ce1edeead8d0f9e5d88e829d415057117502a335.

Post-deployment localhost trade-history API verified the actual entry has action SELL, positionSide SHORT, and routeLabel Short V20. This documentation commit does not require an additional UI deployment.
