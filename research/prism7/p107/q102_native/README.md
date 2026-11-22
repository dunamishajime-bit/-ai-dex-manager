# P107 Q102 pinned source historical coverage and mandatory fail-closed gaps

Source pin: c7310d34ba1b6de07071d8883a2ed0de8dcce2a7; source-native functions buildQuality102CausalV4Signal and resolveQuality102CausalV1Runtime.

## Evidence

- 38 available ASTER H1 symbols inventoried including early/warmup. At the requested 2025-10-01 entry start, 15 of those 38 lacked 181 days H1 before the BT start (not all 38 are Q102 signals; do not interpret as 15 Q102 routes).
- The *actual pinned Q102 S34 table* contains 11 symbols. Three lack the required 181-day H1 at the start: FETUSDT and LDOUSDT have earliest 2026-01-09 18:00 UTC, RENDERUSDT earliest 2026-01-06 13:00 UTC. The earliest 181-day historical warmup for those sources is July 2026, not October 2025.
- Of the actual S34 11 symbols plus BTC, **one** malformed OHLC bar was found: BTCUSDT 2025-09-13 13:00 UTC, open 115941.8 exceeds high 115916.1. In official ASTER public API (v1 and v3 GET kline), this exact invalid original value still appears, byte-identical responses SHA256 e5d84f66ab0f4e94d8a6ada3fae26815efd27f8bf5f51517d05afcf3785a5458. It is therefore NOT evidence of isolated local file corruption; do not silently fabricate a replacement high.
- Exact current pin TS source direct H1 asof on 181-day *AVAX/BTC only* rolling window: on 2025-10-01 01:00 UTC it fails closed with QUALITY102_INVALID_CANDLE, as expected; on 2026-08-03 01:00 UTC source returns no signal. Q102 startup runtime maximumGross 0.50 was resolved via exact pinned config and tested.
- Real live Q102 high-vol universe is not wholly represented in this two-symbol test; these are source-level positive/negative control tests, **not** a full-Q102 backtest nor all-Runners portfolio replay.
- A one-year fully verified source-native P107 cannot be stamped PASS while required historical venue bars are absent and official malformed OHLC is not covered by a separately certified data treatment. Historic source must be retrieved from authenticated official market archives or affected intervals must fail closed. Every data substitution must be a separate comparison scenario, never silently treated as ASTER native truth.

## Reproduce

Use the owner's isolated research PC source workspace C:\tmp\disdex-prism7-p107-parity-audit-20261122. The Q102 current source has been checked out as a separate git worktree under q102-pin-source-c7310d34. Its git HEAD is the exact pin. The TypeScript harness in this directory must be copied to the workspace root (its imports are workspace-relative); it needs the generated 181-day H1 input JSON produced by the local prep script. The full input (approx. 2 MB) remains local and is not embedded in GitHub.

Run the two source-negative/positive samples with existing TSX. The direct source tests cannot authorize LIVE orders. No order, STOP, VPS or GLOBAL HOLD change made.
