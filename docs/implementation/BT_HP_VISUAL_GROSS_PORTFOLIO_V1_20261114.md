# BT visual Gross and portfolio — 2026-11-14

Status: UI_MVP_LOCAL / NOT_DEPLOYED / CANONICAL_BT_NOT_CONNECTED

Owner-approved: B main = actual Gross x usage; A auxiliary = percentage of explicitly named cap.

## Display and replay rules

- Gross is absolute exposure, NOT net exposure. Position Gross = absolute position notional / canonical equity allocation base at event time.
- Total, Crypto, Stock meters display x used / x cap prominently, and % next to it. Historical cap defaults Total 3.50x, Crypto 3.00x, Stock 1.50x are DEMO ONLY; replay must use exact historical risk limits.
- Positions each show logic, symbol, direction, quantity, entry, mark, notional, unrealized PnL, absolute Gross and fraction of Total cap.
- Portfolio positions, Gross meters, equity and BTC representative chart must always share the exact simulated timestamp.
- Entry/exit markers must show actual traded symbol, not falsely imply every event is BTC.
- On accepted or rejected order and on each partial fill or exit, persist portfolio-before/after, Gross-before/after, risk checks, pending/reserved exposure, capacity blockage and order evidence.
- The canonical BT execution engine, not the HP, must decide signals/fills/risk. No HP-only economic logic or invented fills.
- Mode separation REAL_DATA versus SYNTHETIC is mandatory, with synthetic seed and data SHA captured.
- Preserve replay data and manifest including logic pins, engine SHA, data hashes, period, fee/funding models and every event, and allow JSON/CSV/ZIP and PDF exports to Codex/GPT.
- No production order, STOP, position, Kill Switch or runner modification is ever allowed from this page.

## Current scope

The new route app/bt-verification/page.tsx contains an isolated illustrative UI MVP: time controls, BTC path, equity curve, live position table, Total/Crypto/Stock Gross stacked meters, per-position cap share, logic/symbol filtering, JSON import/export and CSV timelines.

NOT YET BUILT: canonical BT adapter, authenticated durable storage, ZIP/PDF, reference-source consistency checks, formal QA, menu navigation, deployment. The sample numbers must never be interpreted as real BT results.


## Implementation extension (same Draft PR #481)

- lib/bt-verification/replay.ts: strict, bounded replay JSON validation; source-snapshot Gross authoritative over reconstructed position allocation; unresolved exposure must be displayed as grey/unallocated rather than invented per-position metrics.
- lib/bt-verification/storage.ts: per-browser IndexedDB save / list / reload / delete. Local-only, not cross-device durable server storage.
- lib/bt-verification/zip-store.ts: no third-party ZIP store; ZIP includes replay.json, portfolio_timeline.csv, positions_timeline.csv, event_ledger_display.json, manifest.json, README.txt and SHA256 checksums.
- components/bt-verification/BtcCandlestickChart.tsx: last 64 completed BTC 1h OHLC candles, marker overlay for reported event times. No lookahead; no conversion of BTC representative chart into trade symbol.
- scripts/bt_hp_research_replay_adapter.py: READ-ONLY RESEARCH DATA ADAPTER. It reads existing model-equity/fills/decisions/Shared Risk rows and optional historical BTC candle gzip, emits a 1y research playback with event timestamps and source hashes. All position quantities/marks/current per-position Gross remain null where research fills cannot supply exact evidence.
- tests/test_bt_hp_research_replay_adapter.py: reject inconsistent Gross / duplicate trade ID, check BTC completed-candle as-of behavior.
- scripts/bt-hp-replay-selftest.ts: strict import / gross / ZIP tests.

Research-replay diagnostic (not canonical/verified):
- Input: November 13 FIVEBT_P3_20261113 (10bps) research run, venue fills not proven.
- Test conversion: 4,073 frames, 853 model fills, 8,928 BTC hourly candles, 4.93 MB output; every snapshot BTC close checked against last completed candle.
- Observed max Total Gross 4.6785429617x, **not evidence of authorized Production Gross cap**.
- Conversion CLI requires explicit Total/Crypto/Stock cap arguments, preserving note USER_SUPPLIED_NOT_VERIFIED. These cap arguments MUST be verified against the BT run's true risk manifest before using percentage comparisons.
- Partial / missing per-position mark, quantity or Gross is represented as null and must never be back-filled with guessed prices.

## Still required before ready-for-review or HP deployment

1. Retrieve and pin the truly latest *verified* strategy and engine versions, SHA and parity evidence; register only confirmed logic/config source.
2. Bind replay to the canonical immutable BT engine and event/fill model, incl. fee, funding, tick/lot constraints, time alignment, STOP, trailing, partial fills, risk, pending exposure and gross transfer.
3. Add event-level exact position mark/notional and Gross allocation snapshots and compare reconstructed total with canonical equity ledger to tolerance. Avoid dividing by a different equity base at any timestamp.
4. Owner-authenticated backend storage with object retention, quota and replay search; multi-device saved results, ZIP and optional PDF report.
5. Full e2e UI test (selection, pause/rewind, marker details, cost parity, huge replay, export/reimport), Production auth security review and safe deploy.
6. Keep all read-only BT APIs and data separate from LIVE keys, orders, STOP and Kill Switch.

**No production deployment, merge, LIVE trading change or claim of verified BT parity is authorized by this Draft PR alone.**


## Replay visual refinements — 2026-11-14

- The first demo-only equity polyline had an absolute 10,000-JPY center and fixed scaling. It was unsuitable for the actual multi-million-JPY backtest range; replaced with EquityTimelineChart using a cursor-bounded dynamic Y scale, historical running maximum drawdown, start/current/min/max, and extrema-preserving bucket downsampling. No future equity values are read.
- GrossAllocationPanel replaces generic cyan/violet segments with stable per-position color segments, explicit Total/Crypto/Stock x-values and % of each cap, color-coded legend, position gross / total gross and position gross / total cap as separate denominators, and an exact unallocated Gross segment whenever per-position Gross is unknown.
- BTC event markers can be clicked or keyboard-activated to jump to their associated replay frame. The per-event Gross comparison is explicitly labeled previous sampled snapshot vs current sampled snapshot, not exact pre-order/post-order state.
- Mobile BottomNav includes a BT検証 link and horizontal overflow scrolling instead of shrinking every item to unreadable widths.
- Post-change TypeScript typecheck PASS and Next.js 16 production build PASS (route /bt-verification generated).
- No production deployment was made.


## Source-derived strategy registry

- The read-only adapter emits strategyCatalog from the input research model fills. The catalog includes logic name, model-fill count, recorded source runtime commit SHA(s), model class, route count and symbol count.
- Each entry is deliberately flagged RESEARCH_SOURCE_UNVERIFIED; the source SHA is neither the latest LIVE pin nor evidence that present-day fully validated settings match the research replay.
- The BT page displays these pinned references separately and derives the add/remove dropdown options from the loaded replay's logic/position catalog rather than an older hard-coded universe.
- Five Python adapter tests PASS; TypeScript typecheck (both project configurations) PASS. Representative 10bps research export contains 7 recorded logic families. Replay JSON SHA256 on the local PC is 117806620b399f165331af144cb02274395328ca2ffd467e3acce01dd796aa56.
- Outstanding: Verify all current production and latest research SHA sets, logic economic parameters and canonical backtest parity before marking any source pin as canonical or enabling new backtest execution from the HP page.

## 2026-11-14 — Source-traceable Gross caps, partial exits and owner archive

Risk caps are run-specific, not hard-coded:
- Research run FIVEBT_P3_20261113 (10bps/30bps) manifest: Total 4.25x, Crypto 3.00x, Stock 4.00x.
- Research run STABLE4_OPPORTUNITY_PROD_CAPS_20261114: Total 3.50x, Crypto 3.00x, Stock 1.50x.
- Research run STABLE4_HYPE6_Q102_DUALHEALTH_VALIDATION_20261114: Total 4.25x, Crypto 3.00x, Stock 4.00x.
- Adapter resolve_gross_caps selects the unique 10bps or 30bps case in RUN_MANIFEST.json and rejects conflicting CLI overrides. Category caps can be higher than Total cap because they are independent constraints.
- grossCapEvidence SOURCE_SUMMARY_MATCHED_RESEARCH_ONLY means the research manifest was matched; it does NOT certify Production runtime caps or current trading logic parity.
- Research Gross snapshots can exceed the recorded original entry threshold because marked exposure moves with prices/equity; do not reinterpret an entry cap as a guaranteed continuous cap or suppress warnings.
- Read-only model fills contain entry Gross but not signed actual quantity or current per-position Gross. The UI shows original per-position Gross as a separate historical entry baseline, not current Gross; source category/Total Gross remains primary, with unresolved allocation grey.
- PENGU source partial-close events are parsed. At coincident timestamps ENTRY -> PARTIAL -> FINAL EXIT ordering is preserved, with original entry Gross and last partial remaining Gross tracked separately.
- Browser import cap raised to 60MB for one-year replay files.

Reproducible research replays on PC:
- Directory: C:\tmp\bt481-hp-replay-library-20261114
- Four JSON outputs plus INDEX.json (file hashes).
- STABLE4_OPPORTUNITY_PROD_CAPS_20261114 10/30bps: 1,027 / 1,023 model fills.
- STABLE4_HYPE6_Q102_DUALHEALTH_VALIDATION_20261114 10/30bps: 795 / 791 model fills.
- Each has ~8,900 frames and 8,928 completed BTC 1h candles; all recorded partial events are retained. All four passed TypeScript schema import validation.
- These are research-model outputs, not signed exchange executions or newly computed verified current LIVE backtests.

Optional owner-authenticated server archive:
- lib/server/bt-replay-store.ts and app/api/bt-verification/runs provide GET list, POST save, GET id, DELETE id. Owner HMAC session is verified for all calls; mutations require same-origin Origin.
- Data isolated per signed owner subject (SHA256 namespace), random UUID filenames, atomic writes, SHA256 payload checks, access separation, 30MiB/run, 40 runs / 300MiB owner quotas; no arbitrary paths.
- Fail-closed (HTTP 503) until Production operator configures an absolute access-controlled DISDEX_BT_ARCHIVE_DIR, physically isolated from LIVE and public build assets. DISDEX_BT_ORIGIN optionally locks the HTTPS origin.
- Client retains local IndexedDB fallback. Server does not claim saves before confirmation.
- Temporary security tests used a synthetic HMAC owner key and temporary directory. No Production auth secrets were changed.

Still pending: New canonical BT execution from HP, source-verified per-position quantity/current mark/current Gross at every tick, immutable pin reconciliation, browser E2E tests, production origin/storage provisioning, owner approval and deployment. BT UI and archive remain separate from LIVE orders, STOP, shared risk and runners.


## Model performance report, event quality and reproducible replay batch (2026-11-14)

- Adapter reads source modeled-funding cashflow ledger as annotated events (not signed venue executions) and includes source SHA256. Reported equity remains copied from the original equity snapshot; it is NOT recomputed from funding to avoid double-counting.
- ENTRY event annotations retain model route and signal ID; EXIT carries reason and modeled net JPY PnL. PENGU PARTIAL events are preserved when simultaneous with a final EXIT.
- Default event UI focuses on actual model ENTRY / EXIT / PARTIAL markers, with selectable RISK, FUNDING or ALL views. This prevents several thousand modeled funding events from hiding actual trades.
- Source RUN_MANIFEST.json supplies researchSummary with cost bps, initial JPY, final JPY, model-fills, win-rate, max hourly DD and profit factor. The research metrics are clearly marked as model-only and distinct from the independently computed replay-so-far equity curve.
- Strategy/symbol group performance is derived from model closed fills only: closed count, win rate, net modeled PnL, max single modeled loss. Distinguishes group PnL from compounded portfolio results. This group table is included in ZIP and CSV exports.
- scripts/bt_hp_build_replay_library.py regenerates 10bps/30bps replay JSON and INDEX.json deterministically for a new research case directory. Automatically loads the run's source CAP manifest, fills, funding, shared-risk events, partials, decisions and optional BTC candles; verifies fill counts and hashes. Does not run any strategy, place orders or access LIVE.
- Output remains an evidence viewer, not canonical BT execution. The desired HP-side BT-start action for arbitrary logic/symbol subsets still requires a properly isolated canonical engine job path and source pin parity certification.

### Storage and deployment caveats

- Protected API routes are preimplemented and pass isolated synthetic owner-HMAC tests, but DISDEX_BT_ARCHIVE_DIR / secure origin have not been provisioned or enabled on Production.
- DO NOT deploy until owner approves formal HP deployment. The Draft PR must remain separate from trading system order routes, current runtime keys, STOP, Shared Risk and kill switch.
