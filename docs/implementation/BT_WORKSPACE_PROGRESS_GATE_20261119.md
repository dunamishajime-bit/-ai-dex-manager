# BT Workspace: implementation checkpoint and release gates

This is a read-only research UI feature. Production trading routes, orders, STOP, Kill Switch, Runner activation and Owner approval flows are not altered. Do not mark all 17 tasks complete on the strength of a green build.

## Task-by-task state after local implementation and source audit

| Task | Verified state | What still blocks completion |
|---|---|---|
| BT-01 | Data mode selector and separate research data loader implemented | Certified baseline runner integration |
| BT-02 | Research ledger strategy selector and symbol candidates | Live pinned configuration-derived route catalog and exact per-route toggles |
| BT-03 | STABLE4 research fill source SHA references identified and found as local Git commit objects | Current deployment SHA read-only verification, pinned runner entry/exit/STOP execution parity, shared risk/gross, full fill accounting |
| BT-04 | Reusable ledger integrity 12 hashes PASS; six standalone and two STABLE4 research dataset files generated locally and independently SHA verified | Production-equivalent eight-runner data coverage, causality, missing bars and fills |
| BT-05 | Synthetic date range input bounded by prior JST calendar day | More robust time-zone/day-candle handling for all supported venues |
| BT-06 | Authenticated Aster UTC prior-date *closed* daily anchor; deterministic multi-symbol backward OHLC; forward day-by-day chart replay | Intraday 1h/5m microstructure and active strategy signals; source anchor provenance UI |
| BT-07 | Symbol dropdown/own-candles synchronized for anchored data | Actual bar availability and verified marks per symbol for historical replay |
| BT-08 | BTC overview chart with timestamp-aligned study-model event markers | Verified all-route event linkage and source fill price/quantity, not just timestamps |
| BT-09 | Candidate, blocked, model entry/exit, deposit and risk classified separately | Source-complete structured reason/decision ledger for every route |
| BT-10 | Editable starting JPY capital, default 10,000 | Live pinned execution sizing re-run for changed capital |
| BT-11 | Simple vs compound sizing primitives, no profit compounding in simple mode | Connection to complete portfolio entries/exits/limits |
| BT-12 | Optional recurring contributions and separate cash flow accounting | Source-specific execution sizing under live portfolio risk gates |
| BT-13 | Unitized cash-flow-adjusted drawdown; MTM/gross source snapshots for STABLE4 study | Reconciliation of full individual holdings, funding/fees, exposure and true production gates |
| BT-14 | Playback pause, seek, speeds; BTC and per-symbol synchronized | Full intraday performance and large-model stress test |
| BT-15 | Cost scenario pair comparison only if source model and BTC evidence match; study label | Strategy change A/B across truly same market and fully pinned engines |
| BT-16 | Portfolio, event, provenance CSV/JSON; source SHA in local private manifests | Full fill ledger and comprehensive immutable experiment store |
| BT-17 | Existing owner AuthGuard and owner-signed read-only anchor API, TypeScript and targeted unit tests PASS | Production build, CI, review, Owner-gated deployment, browser acceptance and source completeness |

## Local datasets (never silently copied into production or Git)
- Archived standalone bundle: `C:\tmp\disdex-bt-20251001-20261001\REUSABLE_BT_LEDGER_20261108_V1`
- Local standalone exports: `C:\tmp\disdex-bt-baseline-export-20261118` (IDLE, FET, HYPE x 10/30bps; NOT full eight-runner)
- STABLE4 research source: `C:\tmp\disdex-bt-20251001-20261001\STABLE4_OPPORTUNITY_PROD_CAPS_20261114`
- Local STABLE4 exports: `C:\tmp\disdex-stable4-research-baseline-export-20261119` (10/30bps)
- See `docs/research-results/BT_BASELINE_REUSABLE_LEDGER_AUDIT_20261118.json` and `docs/research-results/BT_STABLE4_SOURCE_PARITY_AUDIT_20261119.json`.

## STABLE4 research parity observations
- Model exits: 10bps=1,027; 30bps=1,023. The extra one admitted Q102 entry remains a terminal open position (model evidence only).
- Research admits seven named runner groups: V4, PENGU, Q102, V52, FET, HYPE, IDLE; this does not establish all current eight-runner runtime routes.
- Each modeled runner source SHA resolves to a local Git commit. This is **not** evidence of the currently deployed runtime SHA, and not proof of source-code parity for the simulated fills.
- No signed exchange executions in this dataset.
- Source 10bps max DD -22.5951%; source 30bps -23.2195%. Both violate the research target of maxDD 20% or less. Do not promote to certified baseline.

## Release gate
Any complete label / production deployment requires, in order: exact current Production pin read-only snapshot; accessible causal market bars per chosen symbol/timeframe; full 8-runner exact entry/exit/risk re-execution; replay-to-ledger reconciliation and reproducibility; unit tests; Next build; branch CI; owner-reviewed HP-only deployment. This documentation is not an instruction to bypass approval. Never send test/live orders or modify trading configuration for this UI project.
## November 19 continuation checkpoint: live multi-SHA and replay source gate

Progress completed on feature branch feat/bt-workspace-phase1-20261118, PR #500:
- A read-only owner-PC SSH audit found current LIVE pin coverage across V4, Q102, V52, PENGU, HYPE, FET, IDLE and SharedRisk, using the Desktop/DisDex.pem key locally and without exporting credentials.
- The eight selected production entrypoint files match the corresponding Git blobs: two byte-identical; six differ only in CRLF/LF after normalization. Evidence is docs/research-results/BT_VPS_ENTRYPOINT_PARITY_20261119_UNCERTIFIED.json.
- The Source SHA gate found STABLE4 research mismatches for V4 and HYPE affecting 806/1027 modeled exits at 10bps and 802/1023 at 30bps. Reusable evidence is docs/research-results/BT_STABLE4_VS_LIVE_SOURCE_20261119_UNCERTIFIED.json.
- Dedicated GitHub Actions BT CI includes Python unit tests, replay tests, typecheck and Next production build; initial two Actions runs 44408877886 and 44408886835 succeeded for commit b3f074ef7.
- V52 was absent from one active-unit sampling and has >2277 historical restarts. No runner service action was taken; current live readiness requires separate investigation.
- No order, position, protective stop, trading credential, risk limit, service state or Kill Switch was modified.

NEXT BLOCKERS remain: exact imported/dependent runner code parity; reconcile Pinned LIVE V4/HYPE to STABLE4 study or recompute using actual live code; actual causal market bars and complete eight-runner risk/priority/fill/exit modeling; variable-cash-flow portfolio re-execution; live stability and CI on latest head; Owner-approved HP-only release. A source SHA or a single successful CI build never certifies production-equivalent BT. Always preserve uncommitted state and resume using scripts/research/resume_bt_workspace_checkpoint.ps1.