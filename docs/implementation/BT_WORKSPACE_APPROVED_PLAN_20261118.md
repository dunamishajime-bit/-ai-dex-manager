# BT Workspace: approved specification and execution ledger (2026-11-18)

Status: OWNER-APPROVED SPECIFICATION; IMPLEMENTATION IN PROGRESS. Do not claim features are deployed until verified.

## Immutable principles
- BT workspace is authenticated, read-only with respect to production trading. No real orders, cancellations, STOP edits, position edits, Runner or Kill Switch changes.
- Existing production HP navigation/design must remain intact.
- Preserve data provenance, pinned implementation SHA, input dataset hashes, and reproducible replay logs. Missing data or implementation mismatch is NOT a certified BT.
- Separate candidate signal, risk approval/rejection, virtual fill, and exit events. BTC/USDT overview shows timestamped events from all selected symbols without using other symbols' prices as BTC prices.
- Selected strategy must run the actual pinned entry/exit/priority/risk semantics, not a name-only approximation. Never label a synthetic demonstration as production-equivalent.

## Approved task ledger
| ID | Task | Acceptance criteria | Status |
|---|---|---|---|
| BT-01 | Dataset mode | Explicit synthetic simulation vs historical baseline switch | TODO |
| BT-02 | Strategy selector | Current registered strategy routes selectable; associated symbols follow; no LIVE mutation | TODO |
| BT-03 | Pinned strategy execution | Entry, exit, STOP, priority, shared risk and gross match source SHA with evidence | TODO |
| BT-04 | Historical baseline | Reuse previously acquired source market data and ledger; integrity and gaps surfaced | TODO |
| BT-05 | Simulation dates | Start/end dates selectable, end no later than prior local calendar day | TODO |
| BT-06 | Anchored synthetic prices | For each symbol, simulated final close equals actual previous-day close; backward seeded OHLC generation; chronological forward replay; never reveal future bars to signal logic | TODO |
| BT-07 | Symbol charts | Each selected symbol chart shows only its own signals, fills and exits | TODO |
| BT-08 | BTC overview | BTC/USDT chart aggregates all strategy/symbol fill events by timestamp | TODO |
| BT-09 | Event categories | Candidate, approved, rejected, filled, exited visually distinct | TODO |
| BT-10 | Starting capital | User-editable JPY; default JPY 10,000 | TODO |
| BT-11 | Compounding | Compound vs simple sizing with cash and risk gates applied | TODO |
| BT-12 | Contributions | On/off, JPY amount, weekly/monthly schedule and contribution day | TODO |
| BT-13 | Accounting | Separate deposits, strategy PnL, equity, drawdown, gross; recalculate fills rather than scale past PnL | TODO |
| BT-14 | Playback | Start/pause/speed/seek synchronize all symbol charts and portfolio timeline | TODO |
| BT-15 | Comparative research | Fixed identical market seed/data, compare strategy and capital configurations | TODO |
| BT-16 | Evidence export | Export settings, seed, hashes, SHA, fills, rejections, metrics CSV/JSON | TODO |
| BT-17 | Integration | Auth, responsive HP/BT navigation, tests, CI, owner-gated production deployment | TODO |

## Baseline dataset contract
- UTC interval [2025-10-01T00:00:00Z, 2026-10-01T00:00:00Z), end exclusive.
- Previously downloaded actual market bars and reusable transaction/evidence ledgers; verify file existence, hashes, completeness, exact runner/source parity before exposing as certified baseline.
- HYPE and IDLE hypothetically enabled for research only, as previously specified; clearly disclose this assumption.
- Default starting capital JPY 10,000, independent 10bps and 30bps cost scenarios; capital and cost adjustable only with valid rerun, not arithmetic scaling.

## Synthetic market contract
- User chooses arbitrary historical start/end, end <= previous day in Asia/Tokyo.
- Each selected symbol uses the latest available actual previous-day closing price as the synthetic end-date close. For example, 2026-01-01..2026-08-31 selected on 2026-11-18 uses the actual 2026-11-17 close as the simulated 2026-08-31 close.
- Generate backwards from anchor with reproducible seeded stochastic OHLC; simulate correlated regimes across symbols; replay chronologically. No future price/anchor leakage into strategy evaluation.
- If authentic anchor price is unavailable, show unavailable/error rather than silently invent a real-world close.

## Accounting contract
- Compound: realized equity changes affect future sizing; simple: sizing based on fixed principal plus defined contributions, never compounded profits; all actual cash/position/gross limits remain binding.
- Contributions are external cash flows, not profit; separate contribution schedule, net deposits, trading PnL, equity, and cash-flow-adjusted drawdown.
- Save a complete configuration snapshot for replay and comparison.

## Execution phases
1. UI conditions/strategy and symbol chart shell: BT-01/02/05/07/08/10/11/12.
2. Verified data sources and pinned execution: BT-03/04/06.
3. Event playback and portfolio accounting: BT-09/13/14.
4. Comparative analysis and exports: BT-15/16.
5. CI, staging, authenticated verification, owner-approved HP-only deploy: BT-17.

Each completed phase: isolated commit, tests, push, PR and recorded evidence. No autonomous Production deployment or bypass of owner approval.
## Progress checkpoint 2026-11-18 (non-production)
- UI-only conditions panel: implemented, but NOT connected to execution or persisted settings.
- Reusable baseline ledger: 12 SHA256 file hashes PASS, standalone evidence only; eight-runner portfolio and live fill parity NOT certified. See docs/research-results/BT_BASELINE_REUSABLE_LEDGER_AUDIT_20261118.json.
- Seeded anchored multi-symbol daily OHLC generator: implemented and unit-tested; external real prior-day anchor acquisition and intraday replay remain TODO.
- Pure capital/contribution primitives: implemented and unit-tested; not yet connected to fills, Gross or DD.
- New unit tests 10/10 PASS, typecheck PASS. Production HP and trading untouched.
- Next blocking work: verify actual production runner SHA and exact code path; map historical bar availability per symbol/timeframe; implement source-safe adapter and replay integration. Do not promote as complete BT until verified.
