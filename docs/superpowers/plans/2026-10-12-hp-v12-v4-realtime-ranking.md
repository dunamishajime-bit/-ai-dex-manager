# HP V12 V4 and Realtime Ranking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HP全ページのV12表示をV4候補契約へ整合し、runtime実測と混同せず、リアルタイム観測のcoverage・score意味・strategy別Top 3を正しく表示する。

**Architecture:** Read-onlyのV4 HP observability modelを一つ作り、decision status APIとV12表示へ共有する。Realtime rankingはV4候補を旧V12 snapshotから分離し、metric種別とranking namespaceを明示する。UI-onlyのXServer公開でTrading runtime・operator gate・注文経路には触れない。

**Tech Stack:** Next.js App Router, React, TypeScript, Node test runner + `tsx`, existing XServer VPS HP-only deployment path.

**Spec:** `docs/superpowers/specs/2026-10-12-hp-v12-v4-and-realtime-ranking-design.md`

## Global Constraints

- V4 target policy IDは `V2_M150_D05_CORE_NATIVE`、route countは `41`。
- HP target policyと実際のVPS runner/runtime stateを別表示し、証拠なしにV4をLIVEと表示しない。
- HP/APIはread-onlyで、`readOnly=true`、`tradingMutation=0`、注文・cancel・建玉変更は0。
- V4判定は `v12-v4-live-decision/v1` の正規sourceだけを使い、旧V12 snapshotへsilent fallbackしない。
- Scoreを表示上の固定値・倍率で水増ししない。native score、route rank、Gate充足度、未取得は別物として扱う。
- V12 V4および各strategyのrankをnamespace分離し、根拠のない全strategy横断Top 3を作らない。
- Top枠はsymbol distinctで各3枠を描画し、不足分は実状態のplaceholderにする。stale/未評価を順位へ昇格しない。
- PC/mobileとも現行30秒更新、効果音、順位アニメーション、順位対象外score表示を維持する。
- Historical V12 strategy IDs、fill attribution、監査eventは書き換えない。
- Vercelは禁止。Desktop SSH key不在またはVPS未到達なら公開せず理由を報告する。
- `config/disterminal-live-config.ts` の実runtime値、Trading release/current、systemd runner、operator artifactはHP表示都合で変更しない。
- dirtyなmain worktree、既存untracked files、無関係なworktree dataをreset/clean/overwriteしない。

## Review Focus

- 最新V4 source/schemaが保存済みhandoffと異なる場合 — preflightでexact commit/schemaを照合し、loader contract testを最新sourceへ合わせる。
- current SHA・V4 heartbeat SHA・decision snapshot SHAの不一致 — observability testで`SHA_MISMATCH`となり、旧snapshot fallbackがないことを検証する。
- `candidate`/`filtered`/route manifestの一部欠損 — source coverage testで未知分を`NOT_EVALUATED`にし、`NO_SIGNAL`を捏造しないことを検証する。
- score `0`、`null`、stale、strategy-native値の混在 — ranking testで表示値・metric label・順位資格を個別に検証する。
- 同一symbolに複数route/logicがある、または上位候補が3件未満 — top-slot testでsymbol重複なし・3slot・状態別placeholderを検証する。

---

### Task 1: Source preflight and V4 read-only HP observability

**Files:**
- Create: `lib/v12-v4-hp-contract.ts` — HP target label/policy ID and route-count metadata only; no fabricated runtime values.
- Create: `lib/server/v12-v4-hp-observability.ts` — bounded, read-only loader and validation for V4 heartbeat and decision snapshot.
- Create: `app/api/system/v12-v4-hp-status/route.ts` — authenticated GET endpoint.
- Test: `tests/v12-v4-hp-observability.test.ts`
- Test: `tests/v12-v4-hp-status-route.test.ts`

**Interfaces:**
- `loadV12V4HpObservability(options?: { now?: number }): Promise<V12V4HpSnapshot>`
- `V12V4HpSnapshot` contains `schema`, target `{ policyId, expectedRouteCount }`, `displayStatus`, actual `{ currentReleaseSha, activeRunnerId, activeRunnerState, activeRunnerSha, v4RunnerMode, v4ReleaseSha, heartbeatSha, orderEnabled }`, timestamps/freshness, source-derived `{ candidates, filtered, routeCoverage: { expected, observed, candidateCount, filteredCount, unobserved, completeness } }`, `errors`, `readOnly: true`, and `tradingMutation: 0`.
- `displayStatus` is a closed union including `LIVE_VERIFIED`, `STAGED_NOT_LIVE`, `SHADOW`, `STALE`, `SHA_MISMATCH`, `SOURCE_ERROR`, and `UNAVAILABLE`.
- GET response returns that snapshot; unauthenticated access remains 401, exceptions 503, and no write-capable dependency is imported.

- [x] **Step 1: Verify source lineage before code changes** — fetch the latest applicable HP branch and read the current V4 candidate branch/handoff. Confirm exact V4 schema, route manifest availability, and current UI deployment lineage. Prepare a clean implementation worktree on `codex/hp-v12-v4-realtime-ui-20261012` from the latest confirmed HP base and carry this approved spec/plan without touching the dirty main worktree. If GitHub or the required source cannot be read, stop before source changes.
- [x] **Step 2: Write failing loader tests** — assert exact schema/policy match; current/V4 SHA mismatch → `SHA_MISMATCH`; stale heartbeat or decision → `STALE`; missing source → `UNAVAILABLE`; incomplete route manifest → reported unobserved coverage, never fabricated `NO_SIGNAL`; all outputs retain read-only flags.
- [x] **Step 3: Implement the HP contract and loader** — parse source JSON as `unknown`, enforce bounded file size and absolute configured paths, validate schema and timestamps, compare source SHA to current production SHA, and derive coverage only from the canonical route registry plus actual candidate/filtered records. Import no Aster signing/order or trading mutation APIs.
- [x] **Step 4: Write failing endpoint tests** — assert auth, `Cache-Control: private, no-store`, 401/503 behavior, and successful response flags `readOnly=true` / `tradingMutation=0`.
- [x] **Step 5: Implement `GET /api/system/v12-v4-hp-status`** using `loadV12V4HpObservability()`; keep the handler GET-only and unauthenticated callers blocked.
- [x] **Step 6: Run the focused tests** — `npx tsx --test tests/v12-v4-hp-observability.test.ts tests/v12-v4-hp-status-route.test.ts`; expected: all cases pass.
- [x] **Step 7: Commit this task only** after reviewing the staged path list.

### Task 2: Realtime observability coverage and metric semantics

**Files:**
- Modify: `lib/realtime-ranking.ts` — typed metric and scoped ranking contracts.
- Modify: `lib/server/realtime-ranking-observability.ts` — source V12 rows from the V4 HP model, not old V12 decision files.
- Test: `tests/realtime-ranking.test.ts`
- Test: `tests/realtime-ranking-observability.test.ts`

**Interfaces:**
- Extend `RankRow` with `scoreKind: "NATIVE" | "GATE_COMPLETION" | "UNAVAILABLE"`, `scoreLabel`, optional `rankingScope`, and optional `sourceRank`; preserve `score: number | null`, `fresh`, and existing `gates`.
- `RealtimeTopSlot = { slot: 1 | 2 | 3; status: "CANDIDATE" | "NO_CANDIDATE" | "NOT_EVALUATED" | "STALE" | "SOURCE_ERROR"; symbol?: string; sourceRow?: RankRow }`.
- `topRankedSymbols(rows: RankRow[], scope: string): RealtimeTopSlot[]` returns exactly three slots, deduplicates symbol, uses only the scope’s canonical source rank (or native rank contract), and keeps execution eligibility separate.
- Realtime API rows retain all measured rows, including rank-ineligible numeric values; V4 candidate/filtered rows carry source route, source rank, feature values and V4 display status.

- [x] **Step 1: Add failing metric tests** — verify native score takes its source label/unit, legacy gate average is tagged `GATE_COMPLETION`, missing metric is `UNAVAILABLE`, zero remains numeric but is not silently treated as missing, and stale rows lose ranking eligibility without retaining a fresh score.
- [x] **Step 2: Add failing scoped-top tests** — verify V4 source rank order, deterministic tie-break, one card per symbol, execution-blocked observation remains visible with a block, and exactly three slots with reasoned placeholders for 0/1/2 fresh symbols.
- [x] **Step 3: Implement metric metadata and scoped ranking in `lib/realtime-ranking.ts`** without changing the 30-second refresh constant or existing freshness deadlines.
- [x] **Step 4: Add V4 observations in `lib/server/realtime-ranking-observability.ts`** by consuming `loadV12V4HpObservability()`. Remove old V12 snapshot as a source for current V4 rows; preserve other strategies and mark each row’s source metric. If an evaluator did not emit a row, report it as unobserved rather than manufacturing a zero score or `NO_SIGNAL`.
- [x] **Step 5: Test observation source coverage** — old V12 snapshot must not appear as V4; V4 candidate and filtered numeric features remain visible; source failure is represented as unavailable/stale; non-V12 logic rows are unchanged.
- [x] **Step 6: Run focused tests** — `npx tsx --test tests/realtime-ranking.test.ts tests/realtime-ranking-observability.test.ts tests/v12-v4-hp-observability.test.ts`; expected: all pass.
- [x] **Step 7: Commit this task only** after reviewing the staged path list.

### Task 3: Realtime page Top 3 and complete score display

**Files:**
- Modify: `components/features/RealtimeRankingBoard.tsx` — strategy-scoped panels, 3 slots, truthful score labels.
- Modify if needed: `components/features/SignalGateList.tsx` — distinguish native score from gate completion and source state.
- Test: `tests/realtime-ranking-ui-contract.test.ts`
- Test: `tests/mobile-layout-regression.test.ts`

**Interfaces:**
- Board consumes `RankRow` and `RealtimeTopSlot` from Task 2; it does not calculate trading signals.
- For `logic=ALL`, render separate panels only for scopes with a verified ranking contract; never produce one cross-strategy Top 3 from incomparable metrics. For a selected logic, render that logic’s scope or a non-ranked candidate list when no native rank exists.

- [ ] **Step 1: Add failing UI contract tests** — three accessible top-slot cells exist for the V12 V4 panel; two candidates yield one explicit placeholder; duplicate symbols collapse to their canonical best row; blocked candidates are marked non-orderable; missing/stale score labels differ from numeric zero.
- [ ] **Step 2: Implement grouped Top 3 cards** — use scoped output, not `score > 0 && !executionBlocked` as an implicit cross-logic ranking rule. Keep the full evaluated-row list and its score even for rank-ineligible rows.
- [ ] **Step 3: Add truthful metric/source labels** — show native score, Gate充足度, route rank/features, or unavailable separately; include evaluation/source timestamp and exact unavailable/stale reason.
- [ ] **Step 4: Preserve existing refresh and feedback** — keep 30-second refresh, sound controls, rank movement animation, and existing sound preferences; adapt movement IDs to ranking scope so separate strategies do not cross-trigger each other.
- [ ] **Step 5: Verify responsive layout** — extend `tests/mobile-layout-regression.test.ts` for narrow viewport, three placeholders, long symbol/route labels, and accessible scroll/overflow behavior.
- [ ] **Step 6: Run UI and ranking tests** — `npx tsx --test tests/realtime-ranking-ui-contract.test.ts tests/mobile-layout-regression.test.ts tests/realtime-ranking.test.ts`; expected: all pass.
- [ ] **Step 7: Commit this task only** after reviewing the staged path list.

### Task 4: V4 target/runtime distinction across every HP V12 surface

**Files:**
- Create: `hooks/useV12V4HpStatus.ts` — authenticated client hook for the new status endpoint.
- Create: `components/features/V12V4RuntimePanel.tsx` — shared target contract, actual runtime state and source freshness panel.
- Modify: `app/page.tsx`, `app/positions/page.tsx`, `app/decision-status/page.tsx`, `app/decision-status/v12/page.tsx`.
- Modify: `components/features/DecisionStatusPanel.tsx` — current V12 page data only; keep historical lineage semantics.
- Modify: `components/layout/LiveProductionBanner.tsx`, `components/layout/LiveRuntimeBadge.tsx`, `components/layout/Sidebar.tsx`.
- Modify after reference audit only: `app/performance/page.tsx`, `app/history/page.tsx`, `app/history/[logic]/page.tsx`, `components/features/LivePerformanceDashboard.tsx`, `components/features/HistoryAnalyticsNav.tsx`.
- Modify if needed: `app/api/system/decision-status/route.ts`, `lib/server/disdex-decision-status.ts` to expose the verified V4 runtime status without relabeling the old unit as V4.
- Test: `tests/v12-v4-hp-ui-contract.test.ts`, `tests/decision-status-layout-regression.test.ts`, `tests/live-performance-ui-contract.test.ts`.

**Interfaces:**
- `useV12V4HpStatus()` returns `{ snapshot: V12V4HpSnapshot | null; loading: boolean; error: string | null; refresh(): Promise<void> }`.
- `V12V4RuntimePanel` receives the validated snapshot and renders target policy separately from actual runner/runtime identity.
- Historical fill/event rows continue to use their stored strategy IDs; this task does not change `lib/server/historical-fill-lineage.ts`, `lib/server/fill-lineage-evidence.ts`, or `lib/trade-history-attribution.ts` mappings.

- [ ] **Step 1: Add failing page-contract tests** — current V12 page and shared banners show `V2_M150_D05_CORE_NATIVE / 41 routes` as target, while an old, staged, shadow, stale, unavailable, or SHA-mismatched runtime is visibly labeled as such.
- [ ] **Step 2: Add failing historical-integrity tests** — old V12 fill/event IDs and strategy labels remain unchanged; only rows whose actual source/strategy ID is V4 display as V4.
- [ ] **Step 3: Implement the status hook and shared panel** using Task 1’s response type. The panel never infers LIVE from static contract text and does not silently fall back to old V12 decision data.
- [ ] **Step 4: Migrate current V12 surfaces** — home, positions, decision-status overview/detail, runtime banner/badge/sidebar, and current strategy explanations. Keep `disterminal-live-config.ts` as actual runtime configuration; do not rewrite it to make the page appear migrated.
- [ ] **Step 5: Audit remaining V12 references** with `rg -n "V12_X1\.00_ALL|V12 X1\.00 ALL|v12-x1-all|V12" app components lib`. Update current-contract copy only; document/test any retained history, compatibility or old-runtime reference.
- [ ] **Step 6: Run contract/history/layout tests** — `npx tsx --test tests/v12-v4-hp-ui-contract.test.ts tests/decision-status-layout-regression.test.ts tests/live-performance-ui-contract.test.ts tests/mobile-layout-regression.test.ts`; expected: all pass.
- [ ] **Step 7: Commit this task only** after reviewing the staged path list.

### Task 5: Integrated validation, CI, and HP-only XServer release

**Files:**
- Modify only discovered HP source/tests from Tasks 1–4.
- Do not modify Trading runner/systemd/operator files or any deployment credentials.

**Interfaces:**
- Production UI artifact reports its UI build/deploy SHA separately from the Trading release/runtime SHA.
- Deployment uses the repository’s existing XServer HP-only release path, never Vercel.

- [ ] **Step 1: Run focused regression suite** — `npx tsx --test tests/v12-v4-hp-observability.test.ts tests/v12-v4-hp-status-route.test.ts tests/realtime-ranking.test.ts tests/realtime-ranking-observability.test.ts tests/realtime-ranking-ui-contract.test.ts tests/v12-v4-hp-ui-contract.test.ts tests/decision-status-layout-regression.test.ts tests/mobile-layout-regression.test.ts tests/live-performance-ui-contract.test.ts`; expected: exit 0 and all tests pass.
- [ ] **Step 2: Run TypeScript typecheck** — `npx tsc --noEmit`; expected: exit 0.
- [ ] **Step 3: Run production build** — `npm run build`; expected: exit 0.
- [ ] **Step 4: Run `git diff --check` and inspect complete branch diff** — verify only intended HP/API/tests/spec/plan files changed, history mapping files are untouched, and there is no Trading/runtime mutation path.
- [ ] **Step 5: Push the tested commit to the approved HP-only implementation branch** — verify GitHub remote SHA exactly matches local HEAD.
- [ ] **Step 6: Run applicable GitHub Actions and inspect jobs** — require at least one required job, none skipped/cancelled, and success for every required job. A zero-job workflow is not green.
- [ ] **Step 7: Read-only VPS preflight** — verify current UI release, Trading SHA/services, available disk, HP health/API, and V4 runtime evidence. Confirm `C:\Users\dis\Desktop\DisDex.pem` exists without displaying it, then connect as `root@professional-dismanager.net`. If the key, SSH access, or deployment lineage cannot be verified, stop; do not switch hosting or use Vercel.
- [ ] **Step 8: Deploy only an immutable HP/UI release over the XServer path** — preserve current Trading release, `current` trading symlink, all trading units, state, Kill Switch, operator artifact, and Aster positions/orders.
- [ ] **Step 9: Verify desktop/mobile HP and APIs** — confirm all current V12 surfaces say V4 target with actual runtime status; route coverage/score/source labels and three ranking slots are correct; 30-second refresh/audio/motion remain; endpoint is read-only; Trading SHA, PIDs/restarts, positions and open orders are unchanged.

**Failure loop:** Any failed test/build/CI/deploy verification gets a focused regression test and UI-only fix; repeat the complete tests, typecheck, build, push/CI, and VPS checks before another UI-only release.

## Self-review checklist

- [x] Every design requirement maps to Tasks 1–5; no strategy or execution behavior is modified.
- [x] Each freshness/SHA/schema/coverage/zero-score/duplicate-symbol/block/placeholder case has a named test in its owning task.
- [x] Historical attribution is explicitly protected and audited.
- [x] GitHub remote and XServer current state are revalidated before implementation/deployment; saved 2026-10-11 values are not treated as current facts.
- [x] V4 route ranking is used only if the canonical current-cycle evaluator emits a causal runtime-safe rank; research-only rank is excluded.
- [x] Other strategy scores are not globally mixed without an approved common-scale contract.
- [x] UI-only deployment preserves trading runtime, and failure rollback targets only the UI release.
