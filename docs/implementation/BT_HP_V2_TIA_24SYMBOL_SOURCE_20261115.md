# BT PR #481 — Versioned 24-symbol artificial market with native IDLE TIA H1 (2026-11-15)

## Scope and contract

- Existing v1 schema `disdex-bt-synthetic-feed-v1` remains the default. It **must** keep all 23 symbols, historical seeded PR #481 demos and on-disk replay reference behavior unchanged.
- New **opt-in** v2 schema `disdex-bt-synthetic-feed-v2` appends `TIAUSDT` as a sixteenth synthetic crypto symbol (24 total, plus eight stock assets already present in v1). It has a new provenance tag because additional random observations alter subsequent seeded paths, even for BTC/HYPE. This is a **different fictional market**, not a strategy performance improvement.
- All 24 markets remain deterministic from seed, scenario and version. The artificial TIA OHLCV and trading volume have no market or exchange truth; history bars are emitted only at completed H1 as-of the tick time.
- Existing frozen native IDLE signal `lib/bt-verification/pinned-native-idle/idle-priority-short-signal.ts` (upstream SHA256 `76f68ba1ec78f5adb34c68718a28b199f58bd29dd6651a404631326906c2f827`) is used **unchanged** to inspect TIA after 73 completed H1 candles. The separate research adapter distinguishes v1's absent input stream from v2's still warming-up H1 source. The native IDLE TIA route is `IDLE_TIA_BREAKDOWN_SHORT_VOLCAP100`, with original breakout/volume rules.
- Existing v1 TIA status remains `MISSING_SYMBOL`, independent of synthetic HYPE positions. V2 TIA status is determined by the native source, but it is still **entry shadow**: NO_FILL, no generated TIA position, fee, STOP, Gross exposure, portfolio opportunity or trade PnL.
- The BT configuration screen presents a feed version selector in the 23/24 asset H48 candidate sandbox; the standalone research job HTTP endpoint is **v1-only** and disabled for v2, preserving its original authenticated contract. Browser-local v2 performs the artificial-price simulation; the v2 research source embeds its own version marker and note.
- The seven-day OHLCV input audit displays the current version and correct crypto/stock symbol counts. It remains explicitly marked as not a full seven-runner validated strategy backtest.

## Test evidence

- `scripts/bt-hp-synthetic-market-selftest.ts` v1 unchanged: 52,416 five-minute observations and 4,368 BTC closed H1 in six months.
- `scripts/bt-hp-synthetic-feed-v2-tia-selftest.ts`: 2,592 five-minute observations across nine days, deterministic v1 and explicit v1 deep-equal; deterministic independent v2 paths; v1 23 vs v2 24 quotes, v2 valid TIA OHLCV, 216 complete TIA H1 and 72 warmup hours. After warmup, 144 native TIA rejects, 0 native TIA passes in seed=4/down; no invalid source data or orders.
- `scripts/bt-hp-pinned-idle-native-selftest.ts`: engineered positive TIA BREAKOUT SHORT with the original native source; test negative excessive-volume cap and pinned source SHA. The 9-day v1 TIA stream remains explicitly unavailable.
- `scripts/bt-hp-v2-idle-24symbol-replay-selftest.ts`: same 240 H1 timestamps yield exactly 240 TIA `MISSING_SYMBOL` in v1 and 240 genuinely evaluated (not missing) TIA signals in v2, no TIA trades in either version. Two versioned replays use distinct source tags and are internally seeded deterministic. H48 positions remain sole synthetic fill route.
- TypeScript typecheck and Next.js build PASS in isolated branch.

## Critical interpretation

Differences between v1/v2 short-run H48 simulated equity are an **artifact of two different fabricated market paths** from a modified RNG consumption schedule. They are not evidence of an enhanced strategy, production parity, return potential, trade history or genuine alpha. H48 research candidate and real STABLE4 integrated strategy remain separate.

Pending: true native V4/Q102/PENGU/V52 signal source adapters, complete FET/IDLE admission and exits, Q102 14-day causal features and online state, all-runner funding/slot/gross/shared-risk economic ledger, authenticated UI E2E, staging and formal HP deployment. No LIVE or Codex-owned code changed.
