# DisDex Manager — Dedicated BT UI Workspace

Date: 2026-11-14
PR: #481 (Draft). Visual design source: two owner-provided screenshots showing BT condition selection and time-synchronized BT playback.

## User-visible behavior

- Normal HP sidebar keeps its existing BT検証 navigation entry.
- Visiting /bt-verification runs behind the existing Owner AuthGuard but uses an entirely separate dedicated workspace: the trading Sidebar, TopBar, production banner and normal mobile BottomNav are not displayed on this route.
- Desktop dedicated sidebar: 条件設定, 検証実行, 検証結果, レポート, 保存データ. Fixed bottom item: 通常HPへ戻る -> https://professional-dismanager.net/.
- Mobile: dedicated bottom navigation containing HPへ戻る and the same five BT sections.
- Dark navy (#081321, #0d192b) layout, cyan/teal accents, dashboard cards. Desktop conditions are two columns (parameters / BTC chart + logic catalog); playback prioritizes balance, BTC chart, trade events, equity curve, Gross allocation, and the position table.
- Preserve currency correctness: research equity source is JPY and displayed with a yen sign; a USD/USDT model unrealized PnL estimate is never silently summed into JPY equity.
- B primary Gross exposure x and A supporting used/limit ratio still distinguish current Total/Crypto/Stock snapshots from incomplete per-position exposure.
- Tabs remain working controls; selected event jumps to its snapshot; custom scenario selection regenerates a deterministic synthetic visual replay.

## Non-claims / safety controls

- The synthetic generator creates deterministic 1-hour BTC OHLC candles and modeled positions purely for chart/layout evaluation. This is not a backtest of latest production logic, not actual venue execution and not real market history.
- Strategy and symbol choices are DISPLAY filters for existing replay. They do not rerun the BT engine or reallocate Gross. Display the limitation prominently in the conditions tab.
- Real research data can be imported or loaded from an authorized archive. Source SHA remains unverified unless the canonical certification process is completed.
- The isolated public GitHub Pages preview is intentionally unauthenticated but only contains synthetic UI data, disables authenticated server persistence, and has connect-src 'none' CSP; no sensitive account/broker data are published.
- Production HP deployment/merge still needs normal owner approval. LIVE trading, orders, STOP, Shared Risk and runners are untouched.

## Verification

- Next.js 16 production build: PASS.
- TypeScript typecheck: PASS.
- Synthetic demo test for trend/range/down/volatile: PASS, including deterministic seed and 72 frames + 288 candles.
- Previous adapter 10 unit tests: PASS.
- Chromium standalone public-preview smoke: configuration tab, playback tab, results, report, library navigation, chart/position/Gross rendering, authenticated server-save hidden, mobile width 390 and back buttons: PASS; no JavaScript console errors.


## 2026-11-14 — intrabar price motion and causal synthetic signal sandbox

The previously hard-coded DEMO entry and exit timestamps were unsuitable: a candle could
appear fully formed while the matching signal was triggered independently of its price.
They have been replaced by a deterministic, causal, synthetic market/tick engine:

- 144 synthetic hourly BTC/USDT bars, **12 observed price ticks per bar** (5-minute tick granularity, 1728 sequential portfolio frames).
- OHLC bar starts at the previous close. At each tick update current candle close, running high, and running low. Full OHLC is appended to the completed-candle ledger ONLY at its 60-minute boundary.
- ReplayFrame.formingBtcCandle is synthetic-only and includes the *observed-to-now* high/low/open/close, never future high/low. Standard external research replay remains restricted to completed original BTC candles.
- The price process includes deterministic Gaussian innovations, volatility clustering, occasional jumps, mean reversion or regime drift depending on the chosen synthetic scenario and seed. Not calibrated to current BTC market data, **not an actual or predictive BTC market model**.
- Three synthetic-only, NOT production-certified signal gates: DEMO_V4 = current price crosses above the last five **completed** bar highs with a small buffer; DEMO_PENGU = price crosses below the last six **completed** lows with a buffer; DEMO_Q102 = price crosses above the previous six **completed** closing-price mean with buffer. These are UI gate demonstrations, NOT the real V4/PENGU/Q102 entrance algorithms.
- The engine records a DEMO signal decision on every tick: threshold, observed price, crossing status, fired/blocked and reason. No look-ahead and no time-scheduled entries. Position and cooldown conflicts suppress duplicate entries.
- Modeled stops, take-profit, partial close and a time-limit exit respond to observed price/elapsed time. Entry, partial and exit fees are applied at 0.1% per synthetic model leg.
- Synthetic positions size quantity from JPY account equity and a **fixed synthetic FX conversion USDJPY=145**, then value/mark/gross are recomputed at each tick. At each tick, JPY equity must reconcile to initial equity + modeled realized net JPY PnL + open model unrealized JPY PnL. The fixed FX is for illustrative UI accounting and not an actual historical FX series.
- 1x, 5x and 20x replay controls advance a small, bounded number of ticks per presentation step, rather than skipping entire candles. This changes **presentation speed only**, never the signal-engine evaluation.
- Interactive BTC chart displays moving current bar, polished luminous price line, O/H/L/C tick values, running wicks and intra-hour completion gauge, signal markers and an up-to-68-bar rolling window. SVG geometry and x positions transition smoothly.
- Equity chart has a fixed horizontal time axis so the entire curve does not jerk/rescale horizontally at every advancing tick; contains subtle filled area, moving guide and playback progress.
- Replay strict validator admits synthetic-only formingBtcCandle/demoSignals but rejects these fields on external research data.
- Existing research fills/charges, source Gross caps, labels, archive protections and production trading boundaries remain unchanged.

### Checks

- Seed/scenario reproducibility and four market regimes.
- Per-frame completed-bar availability and invariant: the forming candle's high/low must enclose ONLY observed prices.
- Entry events require a recorded fired signal; fired signals must cross a threshold derived solely from earlier closed candles.
- Equity JPY and position-level derived Gross reconcile on every synthetic tick. No future market-bar leak.
- The sample strategy counts are QA-only; they must NEVER be promoted as verified historical win rates or expected strategy returns.
- Validate actual browser playback on desktop/mobile and public GitHub Pages preview before claiming deployment.

Formal HP Production deployment and canonical live-pinned BT engine are still not done; isolated public preview is synthetic-only and can be updated separately.


### Warmup chart (pre-run history)
- A further 68 synthetic 1-hour BTC candles are generated chronologically **before** the 2025-10-01 00:00Z replay start. They appear as already-completed historical context in the chart when the run begins, so the first new candle forms at the right edge rather than in an almost-empty view.
- The market path continues uninterrupted into the replay. No simulated orders or account equity changes occur during the warmup. Causal entry thresholds can use these already-completed historical candles immediately at the first replay tick.
- The exported btcCandles collection contains both prior completed context bars and replay completed bars, with strictly increasing timestamps; the 1728 replay frames only cover the requested synthetic BT playback period.
- Tests assert warmup candle timestamps are all prior to replay start, and use strict as-of closed-candle thresholds at every subsequent entry. 68 warmup bars are display/context data, not 68 hours of hidden performance.


## 2026-11-14 — Owner-authenticated research replay library

### Purpose
Enable the formal authenticated BT page to list, select, replay and download four existing research BT cases from an owner-controlled private server filesystem. Never copy research JSON, venue credentials or account data into Next.js public/, GitHub Pages or the Git repository.

### Separate deployment configuration
- Set DISDEX_BT_RESEARCH_LIBRARY_DIR on the formal HP server only to an absolute private directory containing INDEX.json and its indexed _REPLAY.json files. This is intentionally separate from DISDEX_BT_ARCHIVE_DIR used for user-created saved runs.
- The read-only source on the workstation is C:\\tmp\\bt481-hp-replay-library-20261114 (four cases, 10bps/30bps). It is NOT automatically accessible from Linux VPS. Production requires secure owner-approved installation, private directory configuration and approved deployment.
- Absent config returns HTTP 503. The public GitHub Pages demo contains no research files and does not expose the research API UI.
- Both new endpoints are GET only: /api/bt-verification/research lists metadata, and /api/bt-verification/research/:id delivers the exact allowlisted, SHA256-checked model JSON. Existing HMAC Owner session is mandatory (USER or ADMIN), replies are private/no-store and nosniff. No write/delete/execute method.
- Indexed sourceMode must equal RESEARCH_MODEL_NOT_VENUE_EXECUTION. The sourceStatus explicitly identifies research-only and missing full production parity.
- Server refuses unsafe roots, symlinks, path traversal, duplicate index entries, oversized files, bad source SHA256, malformed replay schema, and mismatched Gross caps, frame counts, model fill counts, or cost summaries.
- The config page's real-data mode allows selecting verified source IDs. Following successful load, the user sees the research model label and the source SHA256 in the report, and later in the GPT/Codex ZIP provenance manifest. Integrity of research inputs does NOT certify latest LIVE strategy implementation, or real venue fills.

### Tests
- Configure DISDEX_BT_RESEARCH_LIBRARY_DIR to the protected workstation test library, then execute scripts/bt-hp-readonly-research-library-selftest.ts with tsx.
- Execute scripts/bt-hp-research-http-auth-selftest.ts with tsx. The test generates its own temporary HMAC test key; validates anon 401, authenticated GET 200, private/no-store, traversal 400 and missing-config 503.
- Validate Python adapter, replay schemas, Next.js build and browser preview.
- Formal production placement and deployment are not yet performed.


## Source completeness check: per-position Gross is NOT in the current research replay

The 2026-11-14 read-only, SHA256-validated, model-replay data shows:
- STABLE4_HYPE6_Q102_DUALHEALTH_VALIDATION 10bps: 8,984/8,984 frames contain source Total/Crypto/Stock Gross. 0/18,412 position-frame records have a current position Gross.
- STABLE4_HYPE6_Q102_DUALHEALTH_VALIDATION 30bps: 8,981/8,981 source Gross frames; 0/18,382 position-frame records have current position Gross.
- STABLE4_OPPORTUNITY_PROD_CAPS 10bps: 8,978/8,978 source Gross frames; 0/28,375 position-frame records have current position Gross.
- STABLE4_OPPORTUNITY_PROD_CAPS 30bps: 8,975/8,975 source Gross frames; 0/28,188 position-frame records have current position Gross.
- These are model study records, not signed venue fills and not current production-pin strategy parity.
- The new report widget computes actual source coverage for Total Gross, BTC price, position quantity, mark price, entry Gross and current Gross, without filling absent fields. It shows a clear warning whenever position-current-Gross is incomplete.

To satisfy the owner's requirement for per-position current Gross%, the future canonical replay source must record each position's symbol, logic, side, actual model quantity, market mark price, JPY/USD value with explicit FX conversion, current notional, current Gross x, entry Gross x, total/category Gross snapshots, entry/exit timestamps, partial fills, funding and fees. Account equity and source Gross sums must reconcile at every replay step; do not make up quantities or allocate residual Gross by arbitrary ratio.


## 2026-11-14 — source-as-of portfolio reconciliation and terminal open source model

The research-only replay converter now reads original source snapshots in their
actual timing phase. Same-timestamp matured exits can be counted before new
entries; the earlier purely event-time <= frame-time view could show phantom
positions not present in the recorded Gross snapshot.

The strict optional per-position source file contract and producer integration
requirements are documented in:
docs/implementation/BT_POSITION_SNAPSHOT_SOURCE_CONTRACT_20261114.md

A new private and non-overwriting source-hash-verified research library was built:
C:\\tmp\\bt481-hp-replay-library-terminal-v3-20261114

| Case | Old mismatched emitted frames | New mismatched | Ambiguous |
| --- | ---: | ---: | ---: |
| STABLE4 Opportunity 10bps | 888 | 45 | 2 |
| STABLE4 Opportunity 30bps | 885 | 45 | 2 |
| STABLE4 HYPE6 Q102 10bps | 708 | 45 | 1 |
| STABLE4 HYPE6 Q102 30bps | 704 | 45 | 1 |

The final 45 reconstructed-snapshot discrepancies have a specific known origin:
the source manifested Q102 SUIUSDT LONG open from 2026-09-29 04:00 UTC,
with no matching completed fill in FILLS.csv, and the final 2026-10-01
equity snapshot reports 1 position. The source RUN_MANIFEST contains a
terminal_open_positions record. The RESULTS tab now shows its exact
model strategy, symbol, side, entry time, entry price 1.1156, entry Gross
1.0x and future **model planned** exit 2026-10-02 03:00 UTC separately.
Do not claim actual execution, actual exit, timepoint quantity or current Gross.

The original model equity, realized cash, Gross source snapshots, funding
events, model fill events, BTC candle history, model summaries and all
original input hashes are unchanged across the four derived research cases.
Only the display as-of position alignment and source audit/terminal metadata
were added. The original archive was not overwritten. The v3 replay source
uses an Owner-authenticated read-only API, not public GitHub Pages.

The new strict optional POSITION_SNAPSHOTS.csv contract still requires an
actual model-engine writer at every equity observation; it is not present
in the current historical 4-case source. Terminal model records are NOT
substitutes for complete per-timepoint quantity, mark, FX and current Gross.
