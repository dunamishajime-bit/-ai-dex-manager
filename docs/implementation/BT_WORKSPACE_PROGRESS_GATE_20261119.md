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
## Pinned Git dependency-closure checkpoint
- Reproducible local read-only dependency inventory: scripts/research/audit_bt_live_dependency_closure.py.
- Source file closure counts: V4=69, Q102=36, V52=1, PENGU=25, HYPE=66, SharedRisk=11, FET=11, IDLE=35. No unresolved relative imports in the TypeScript graph. V52 Python import closure is explicitly NOT verified.
- Evidence: docs/research-results/BT_LIVE_GIT_DEPENDENCY_CLOSURE_20261119_UNCERTIFIED.json, including SHA256 per pinned Git source file.
- This is local Git source provenance ONLY. All runtime dependent file hashes on VPS, external npm/python modules, runtime dynamic imports, and exact replay economics are still blocked. No certification implied.
## Read-only VPS static dependency parity checkpoint
- Read-only verifier: scripts/research/verify_bt_live_vps_dependency_bytes.py, using owner-PC Desktop/DisDex.pem only and strict host-key validation. Never copies or logs private key.
- Reconstructed pinned static TypeScript import closures from observed live Git SHA, then checked actual files in each immutable VPS release.
- Result: 254/254 pinned static source files match Git bytes or differ in newline/BOM only; no content mismatches. Per-runner counts V4=69 Q102=36 V52=1 PENGU=25 HYPE=66 SharedRisk=11 FET=11 IDLE=35.
- Evidence: docs/research-results/BT_LIVE_VPS_DEPENDENCY_BYTES_20261119_UNCERTIFIED.json.
- This does NOT cover dynamic imports, Python module dependencies, external npm packages, process memory/runtime drift, current fill logic, or end-to-end BT equivalence. The report explicitly sets production_bt_parity_certified=false.
- V52 restart instability remains separately unresolved; no VPS mutations performed.
## V4/HYPE STABLE4 research versus LIVE code-diff inventory
- Reproducible Git diff: scripts/research/audit_bt_stable4_v4_hype_git_diff.py, report docs/research-results/BT_STABLE4_V4_HYPE_GIT_DIFF_20261119_UNCERTIFIED.json.
- V4 research 53a0be39 vs observed LIVE e788abc8: 95 repository paths changed; 23 changed paths intersect the observed LIVE static dependency closure (69 files).
- HYPE research 7688ed7c vs observed LIVE e0e4f1d8: 432 repository paths changed; 37 changed paths intersect the observed LIVE static dependency closure (66 files).
- Git diff is NOT equivalent to 23 or 37 changed trading rules. Each changed path must be classified by execution semantics and tested against historical causal data before reusing the research replay.
- Do not silently relabel historical STABLE4 trades as LIVE parity. Existing research 10bps DD -22.5951%, 30bps DD -23.2195% remains uncertified and above risk target.
## STABLE4 versus LIVE static execution dependency graph (read-only)
- Reusable audit: scripts/research/audit_bt_stable4_static_graph_delta.py
- Report: docs/research-results/BT_RESEARCH_LIVE_STATIC_GRAPH_DELTA_20261119_UNCERTIFIED.json
- V4 research closure=58, observed LIVE closure=69, modified=12, LIVE_ADDED=11, total delta in graph union=23.
- HYPE research closure=32, observed LIVE closure=66, modified=14, LIVE_ADDED=34, total delta in graph union=48.
- HYPE contains 11 heuristically named signal/entry-classified changed paths; the V4 delta contains no filename-based signal/entry classifications, but changes in authority, risk, order execution and exit protection.
- Filename classification is a triage aid, NOT evidence that a module has changed economic behavior, that a signal stayed identical, or that any historical fill would pass current LIVE gates.
- Research-to-current re-execution remains mandatory, with causal signal, exit, funding, STOP, priority, gross, account freshness, approval and Shared Risk evidence; no trading mutations authorized.
## STABLE4 V4/HYPE modeled loss forensics (not current LIVE BT)
- Input: original private STABLE4 modeled fills CSVs at C:\tmp\disdex-bt-20251001-20261001\STABLE4_OPPORTUNITY_PROD_CAPS_20261114, hashed against the independent research-source audit; raw private CSVs are not committed.
- Reusable aggregator: scripts/research/audit_bt_stable4_model_loss_forensics.py; aggregated report docs/research-results/BT_STABLE4_V4_HYPE_LOSS_FORENSICS_20261119_UNCERTIFIED.json.
- V4 historical model, 10bps: 801 exits, 494 winners (61.6729%), 307 losses, 297 exits with adverse closing-price direction.
- V4 historical model, 30bps: 797 exits, 467 winners (58.5947%), 330 losses, 293 exits with adverse closing-price direction.
- HYPE historical model: 5 exits, 3 winners, 2 losses in both independent fee scenarios; SOURCE SHA DOES NOT MATCH CURRENT LIVE.
- Breakdown includes strategy, route, symbol, entry month, exit reasons, negative PnL and adverse-price exit counts. These are model outputs, not exchange fills, and gross PnL magnitudes are compounded path-dependent; adverse exit is NOT proof of incorrect causal entry.
- Prioritize historical failure-mode test cases for current V4/HYPE reexecution, not overfit to largest historical money loss. Demand out-of-sample validation and complete gross/share-risk context.
## BT Results UI: observed-source comparison (historical snapshot, not current production proof)
- Client read-only component: components/bt-verification/BTResearchLivePinEvidence.tsx, helper lib/bt-verification/source-pin-compat.ts.
- When historical STABLE4 research replay is loaded, show per-strategy model SHA versus the verified 2026-11-19 JST VPS snapshot SHA and mark mismatch explicitly.
- A source SHA match is labeled SHA_MATCH_NOT_PARITY; no data from the UI grants trading authority or certifies historical modeled fills.
- Tests/bt-source-pin-compat.test.ts covers mismatched, matching-but-uncertified, ambiguous/unverified evidence and unknown source; entire BT suite 41 PASS, TS typecheck PASS locally.
- The comparison never claims the stored VPS snapshot represents real-time current process state; no outbound SSH/API call is made by the UI.
## STABLE4 private route-by-symbol replay enhancement (new v2 export, 2026-11-19)
- Added strategyRouteStats to replay contract and fail-closed validator: lib/bt-verification/replay.ts.
- Source export builder scripts/research/build_bt_stable4_research_replays.py now aggregates closed modeled exits and terminal open counts by (strategy, route, symbol).
- Added route diagnostics to BT Results UI with loss count, adverse terminal price count, win rate and model PnL; sorted by cases instead of only raw compounded loss magnitudes.
- Added offline verifier scripts/research/verify_stable4_replay_route_export.ts; validates every imported JSON SHA256 against local manifest, source status, route/strategy/symbol reconciliation, and terminal open counts.
- New private export path (original untouched): C:\tmp\disdex-stable4-research-baseline-export-20261119-v2 (MANIFEST_UNCERTIFIED.json + 10/30bps research replay JSON); do not commit private large raw exports.
- New export integrity: 10bps 1,027 model exits, 321 route+symbol rows, 1 terminal open model position; 30bps 1,023 model exits, 321 rows, 1 terminal open model position. SHA256/route reconciliation and validateReplay all PASS.
- BT targeted suite 45 PASS; TypeScript typecheck PASS. These are historical STABLE4 research models, not production-certified or present LIVE trade fills.
- Historical DD still breaches user target -20%; 10bps -22.5951%, 30bps -23.2195%. Reexecute current LIVE V4/HYPE plus Shared Risk/Gross with causal bars before any production-equivalent BT claim.