# CODEX DEPLOY-ONLY HANDOFF — V12 Score1.00/Volume0.80, 5-logic adopted 1Y BT (2026-09-28)

## Status and ownership

- **All production source edits are already pushed to this handoff branch. Do not ask Codex to rewrite the strategy. Codex's only remaining authorized scope is guarded deployment, read-only verification, controlled activation, and post-deploy monitoring.**
- Repository: dunamishajime-bit/-ai-dex-manager
- Source branch: codex/v12-score100-volume080-production-handoff-20260928
- Original checked production branch: codex/legacy-runtime-safety-audit-20260926
- Original production source SHA: a09ea45ca3cbd72100f9eb0eaae499039c40b6a0
- Actual deployment SHA: resolve the final handoff branch HEAD when starting and PIN THE FULL 40-CHAR SHA. The handoff branch is never deployed by mutable name alone.
- Mode: **PUSHED, DEPLOYMENT NOT EXECUTED**. This document does not grant permission to bypass operator live activation.
- Frozen full-year research source SHA: dbf84542311c15f69508f91a0e7311ff7e686d96
- Immutable complete archival release tag: bt-v12-score100-volume080-normalonly-20260928
- Release: https://github.com/dunamishajime-bit/-ai-dex-manager/releases/tag/bt-v12-score100-volume080-normalonly-20260928
- Annual paired-model CI success: https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36365360968
- Predeploy read-only TypeScript/regression CI: https://github.com/dunamishajime-bit/-ai-dex-manager/actions/workflows/v12-score100-volume080-predeploy-verify-20260928.yml

## EXACT RESEARCH TARGET: NOT A LIVE ORDER-FILL CLAIM

The authoritative 5-logic matched Aster H1 price-model replay is 2025-08-10 through 2026-08-10, JPY10,000 initial + JPY10,000 monthly x12, compounding, source-complete Q102/FET/PENGU/V12 and SHA-pinned original Yahoo-price/V52 tape, ECB daily FX reference.

| Fixed metrics | 10bps round trip | 8bps round trip |
|---|---:|---:|
| Adopted final JPY equity | 141,845,207.7243423 | 175,059,528.3889343 |
| Adopted closed trades | 1,284 | 1,284 |
| Adopted PF | 2.0771737482823114 | 2.124076416274601 |
| Adopted maximum MTM DD | -22.873351303266531% | -22.742907668802037% |
| Same-market original baseline final JPY | 130,287,867.06655651 | 155,417,832.2837019 |
| Same-market original baseline trades | 1,046 | 1,046 |

The quoted JPY value is the **historical in-sample research price model**, NOT actual balance or achievable forward/live return. H1 fills and slippage 8/10bps are modeled, not historical order-book execution. NO real fills from the user's actual Aster account are in the archive.

The exact signed source and paired report are tracked in:
- docs/research/locked-v12-score100-vol080-20260928/selected-v12-five-logic-comparison.json
- docs/research/locked-v12-score100-vol080-20260928/original-baseline-parity.json
- docs/research/locked-v12-score100-vol080-20260928/research-source-provenance.json
- complete immutable release asset (all simulated portfolio trades, candidate admission/rejections, model execution events, source signals, all normalized input Aster H1/funding, V52 archived original source, 90-file audited code snapshot, per-file SHA256 manifest). **The release must exist and its sha256sum must pass before deployment; GitHub Actions artifacts expire.**

## Code already staged in this branch

1. **V12 ONLY normal gate** in config/v12X1AllRuntime.ts:
   minimumVolumeRatio: 0.80, neutralScoreThreshold: 1.00. Byte-exact same V12 config as proven research SHA, SHA256 a2f92b5676d553ac15370be2aeeaabe5cdb8d690e2f4ebb0c971a2f85769668f.
   Existing strong-Regime rescue Score 0.15–0.70 and ATR >=1.4% unchanged; existing nonstrong Momentum rescue 5.4% and ATR>=1.4% **no Score0.35 floor**. Existing HC1.75, win-rate false-burst gate, Top3 Rank3 0.10x and other risk controls unchanged.
2. **Full adopted research risk caps**, independently enforced in production source: Q102 MR0.75, Q102 BRK0.75; other Q102 families unchanged; FET hard max Gross1.00 in both fetBrk48Runtime.ts and integratedProductionRiskPolicy.ts. PENGU and V52 source not changed.
3. **FET entry gates** from research, implemented in lib/fet-brk48-preentry-gates.ts and wired in lib/fet-brk48-live-runner.ts before new order:
   - Overheat block: FET completed 24h price return >=+15% AND 24h previous-close-normalized true-range average >=2%.
   - Relative weakness block: FET 24h return minus BTC 24h return <0 AND FET 24h return <+1%.
   - Require **73 contiguous FET H1 + 25 contiguous BTC H1** bars strictly before the entry H1 boundary, never the current incomplete candle. On missing/broken data, block only FET new entry without triggering global Kill Switch or touching existing positions. For a verified block, persist lastReferenceTs to avoid late duplicate orders.
4. Tests updated: scripts/v12-x1-all-selftest.ts, scripts/fet-brk48-preentry-gates-selftest.ts, plus predeploy CI. npm/TypeScript, V12 risk and simulated order, FET source-gate, Q102 V4 signal/model selftests must pass.

**Important source-vs-research limitation:** original numerical BT first generated the research-source signals and applied the Q102/FET caps and FET gates causally in the shared Python 5-strategy allocator. This branch ports those same cap constants and gate formulas into LIVE TypeScript. The annual BT certifies the research price-model configuration and verifies the V12 config byte-for-byte, but is not itself a full forward/order-book parity certification for every changed LIVE runtime path. Any mismatch in dry-run gates/lot rounding/collision ordering must BLOCK deployment, not be hidden by retaining the attractive 141.845m result.

## Archive contents and immediate reuse

When the immutable release exists, the main directory inside its tar.gz asset is:

selected-five-logic-all-cases-all-costs/BRK0P75_MR0P75_FET1_DUAL_GATE/PRICE_MODEL_10BPS/

Key files:
- portfolio-trades.jsonl — **every modeled accepted closed trade**, modeled entry/exit/size/PnL, not actual fills.
- candidate-decisions.jsonl — every accepted, rejected, slot/cooldown/gross/daily-loss candidate; FET two gate decisions.
- portfolio-events.jsonl — all modeled chronological portfolio events/cashflows.
- metrics.json — model PnL, monthly equity, accounting reconciliations.
- Other sibling directories: PRICE_MODEL_8BPS and all original/all-comparison portfolios, complete signal scans and exit lifecycle ledgers for all strategies, full Aster source H1/funding, frozen V52 Yahoo-reference modeled tape, source code, REPLAY_INDEX.json with SHA256 of every individual file.
- Release assets: complete .tar.gz, .sha256, RELEASE_MANIFEST.json and HOW_TO_REUSE.md. Verify the exact .sha256 next to downloaded archive; compare file-level hashes from REPLAY_INDEX.json before any reanalysis. If release absent or invalid, **BLOCK_DEPLOY_EVIDENCE_UNAVAILABLE**.

## Codex: DEPLOYMENT ONLY — copy-ready guarded execution checklist

1. Resolve, fetch, and PIN the current handoff branch's immutable full 40-char SHA. Verify no changes have been added since this handoff, and that the original production lineage descends from a09ea45c… . Compare whole repo vs a09ea45c; list precisely the adopted V12 normal config, fixed Q102/FET caps/FET dual gates, tests/docs/CI. Do not pull unrelated feature branches or replace the 5-logic model.
2. Confirm predeploy CI is successful at the pinned code SHA (docs-only commits may follow). Run npm ci, npx tsc --noEmit -p tsconfig.json, V12 source boundary tests, FET strictly pre-entry/H1 gate tests, Q102 signal/model tests and direct-order/portfolio routing tests. No test may submit real orders.
3. Require the **complete immutable GitHub Release** to exist and its archive SHA256 to match RELEASE_MANIFEST.json and the adjacent .sha256 file. Recheck original vs adopted 10bps and 8bps metrics, original baseline exact parity, 89/90 unchanged audited study source, source-gate conditions and archive FET/Q102 risk cap contract. Do not confuse PRICE_MODEL fills with the real Aster account history.
4. On Xserver VPS, do **read-only** examination first: actual deployed SHA, running V12/PENGU/Q102/V52/FET, Shared Risk, Margin Guard, watchdog and history sync, open Aster positions/orders, protective orders, pending-exposure reservations, account lock health, Aster rate limits and disk free, effective kill-switch source. If runtime SHA or strategy ownership disagrees with recorded old a09ea45c lineage, STOP and produce a diff before any deploy.
5. Stage a clean release of the PINNED handoff commit. Ensure FET BTC H1 pre-entry gate has adequate rate-budget and is safely fail-closed. Ensure gross/risk caps, order sizing, FET gates, Q102 family caps, V12 score/volume and both original rescue branches are identically exposed to the runner and UI/decision-status; if the UI requires a separate deploy, pin that exact same code commit.
6. Respect operator activation artifact and SHA-gate. No watchdog/auto-repair restart before gate authorization; preserve held positions and existing protective orders, do not force-open historically modeled signals, do not trigger kill switch merely to migrate. Deploy via existing atomic release/symlink and approved systemd contract, not by copying individual files into running releases. Keep last known-good rollback release.
7. With authorized activation, sequentially verify runner effective source SHA and continuous healthy/zero-error read-only signal evaluation, pending-order reconciliation, strategy-specific admission/cap/gate observability, real executor order-path dry-runs, consistent HP state. Compare FET gate fixture outputs to archive pre-entry histories. Confirm no double orders, rate-budget lock races, stale Q102 source mismatch, or new hidden no-trade blockers.
8. Post-deploy, report exact pinned SHA, VPS release path, rollback SHA, operator artifact SHA, runner PID/status and runtime SHA per strategy, health/snapshot freshness, kill-switch state, actual positions/protective orders, gross/margin use, read-only examples of newly accepted/rejected V12/FET/Q102 signals, and whether HP matches. If any stop condition occurs, leave orders untouched, keep prior safely running state or rollback, and report the specific blocker.

**STOP conditions**: archive/replay parity missing; production CI fail; VPS source drift; unowned order/position; kill-switch unexpected; unreconciled pending order; BTC/FET pre-entry H1 source gap; margin guard unhealthy; insufficient disk; operator artifact not authorized for exact SHA. None may be bypassed to meet a deadline.

Deployment status in this handoff: **NOT DEPLOYED**. Only Codex should perform any future authorized VPS activation.
