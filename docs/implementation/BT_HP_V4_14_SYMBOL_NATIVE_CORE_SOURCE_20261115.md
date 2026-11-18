# BT PR #481 — V4 native 14-symbol input completion and FAILED_BREAK H2 shadow (2026-11-15)

Scope: isolated BT page branch; all sources and synthetic prices are offline research. The Codex-owned implementation, LIVE runners, VPS, orders, positions, stops and owner approval paths are untouched.

## Native source and required universe

Reference worktree `C:\tmp\disdex-stable4-impl-20261114` at Git `9118eeaa6c209dc6e37887cf5be139b3baaa005d`. This is a **reference snapshot, not a verified current Production V4 pin**.

Frozen original pure state machine: `lib/v12-v4-native-core.ts`, Windows SHA256 `f1d97f477f2b23e74f8b98cf59813f3c1650479e3c8cbadf6e2fdeeab90a7344`. The local BT copy only changes the `V12Bar` type-only import to a field-only snapshot in `native-v12-bar-type.ts`. Restoring the type-only import and CRLF yields the pinned upstream hash. No logic, thresholds, state transitions or score were changed.

The original `V12_X1_ALL.universe` has 14 symbols: BTC, ETH, BNB, SOL, LINK, AVAX, DOGE, INJ, XRP, ADA, LTC, ATOM, AAVE, NEAR (USDT pairs). Existing synthetic v3 provided only 7. New **v4 opt-in** feed adds the other 7 pairs (BNB, LINK, INJ, XRP, ADA, LTC, ATOM), for **33 total instruments = 25 crypto plus 8 stock**. Existing v1/v2/v3 source versions retain their original symbol order, seed consumption and identities. v4 price paths are a distinct fictional market; differences in simulated H48 equity vs v1/v2/v3 are not performance improvements.

The data adapter creates native closed H2 bars from two contiguous, completed synthetic H1 bars. It rejects stale, future, duplicate, gap or invalid OHLCV. It supplies 61 completed aligned H2 per symbol and BTC and advances the **actual pure `stepNativeFailedBreakCore`** state machine every even UTC H2 boundary for 13 non-BTC instruments, retaining transient setup state between decisions in the research process. It cannot read venue data or execute an order.

## Verified 22-day reference

Test `scripts/bt-hp-v4-native-failed-break-source-selftest.ts`: synthetic seed 20261115, scenario `rotation`, 2025-10-01 00:00 UTC to 2025-10-23 00:00 UTC exclusive, v4 artificial feed.

- 14/14 native V4 source instruments present; v3 would still have **7 missing**, blocked.
- 264 H2 decision intervals, 60 warmup, 204 actually evaluated times with complete 13 non-BTC native source runners.
- Native FAILED_BREAK SHORT events: **3**; these are source state transitions and **NOT** executable V4 trades or historical candidate counts.
- Future/gap/invalid source failures: 0; orders, simulated entry fills, Gross/slot admission, realized PnL: 0.
- Old v1/v2/v3 deterministic feed versions remain separately reproducible, and native H48-only v4 replay labels its different version.
- The BT page includes an isolated `V4元H2判定を検証` control enabled for synthetic v4 only, with 14-symbol coverage, H2 evaluations, sample raw native event details, and explicit unverified production-parity warning.

## What is **not** accomplished

The single native `FAILED_BREAK_REV_SHORT_6H` state machine is only one part of V4. The full V4 generator has numerous other routes, run-specific entry filters, ranking, temporal alignment/entry-price requirements and portfolio allocation. These remain unconnected. The older research ~1,394 original V4 candidates and the integrated `STABLE4_OPPORTUNITY` historical results are not reproduced or asserted by this diagnostic.

The Production V4 SHA might differ from this reference checkout. Full native V4 must be gated on a verified, current source manifest *after* Codex formally finishes its separate LIVE implementation. No code in this BT branch can authorize V4 LIVE. Next: source-manifest reconciliation, V4 other native entry functions and exits, Q102 180-day S1/S2 selection, Online layers, shared portfolio opportunity/risk, full synthetic ledger and UI E2E.
