# HP VPS Runtime Parity and Complete History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the production HP so realtime rows identify their VPS-owned logic and history/performance use a complete, auditable Aster/VPS/local-fill contract without changing trading behavior.

**Architecture:** Build one normalized read-only history contract that owns source selection, pagination coverage, fill identity, attribution, and PnL inputs. Make both the history API/page and performance analytics consume that contract. Extend the existing realtime row contract with `logicName` while keeping `logic`, refresh timing, ranking, motion, sound, and notification behavior backward-compatible.

**Tech Stack:** Next.js/React, TypeScript, Node `tsx --test`, Aster server client, existing XServer VPS UI release process.

**Spec:** `docs/superpowers/specs/2026-10-19-hp-vps-runtime-history-design.md`

## Global Constraints

- This is a UI/observability-only change; do not modify trading runners, strategy conditions, sizing, Gross, Shared Risk, Margin Guard, Kill Switch, state, positions, open orders, or order placement/cancellation.
- Preserve the realtime page's 30-second refresh, preview timing, ranking, countdown, movement animation, sound, and notifications.
- Use authenticated Aster official fills as the authoritative history source; use VPS lineage and local ledger only as non-duplicating enrichment/complement.
- Do not silently truncate history at a page limit; report `PARTIAL` coverage when the defensive limit or a symbol request fails.
- Use trade-level identity; an order ID alone must not merge two partial fills with different trade IDs.
- Never infer definitive logic ownership from symbol alone when explicit lineage is absent; display `UNATTRIBUTED`/`未分類` instead.
- Deploy only the UI release through the existing XServer VPS path; do not use Vercel and do not restart trading services.
- Do not expose or commit secrets, API keys, private configuration, wallet data, or SSH keys.

## Review Focus

- Aster pagination beyond 20 pages must retain all fills or visibly report `PARTIAL`; test with 21+ pages in Task 1.
- Partial fills sharing an order ID must remain separate when trade IDs differ; test this in Task 1.
- Official and local history must merge without duplicate fills while preserving explicit local attribution; test this in Task 2.
- HYPE, Idle, and Q102 attribution must use exact markers and fall back to `UNATTRIBUTED` rather than symbol-only ownership; test this in Tasks 1–2.
- Realtime UI changes must not regress 30-second refresh or motion/audio behavior; test this in Task 3.

### Task 1: Unified history source, coverage, pagination, and attribution

**Files:**
- Modify: `apps/production-ui/lib/server/trade-history-db.ts`
- Modify: `apps/production-ui/lib/trade-history-attribution.ts`
- Modify: `apps/production-ui/lib/server/fill-lineage-evidence.ts`
- Modify: `apps/production-ui/lib/server/aster-trade-history.ts`
- Modify: `apps/production-ui/lib/server/trade-history-source.ts`
- Create: `apps/production-ui/lib/server/live-history-contract.ts`
- Test: `apps/production-ui/tests/aster-account-history-consistency.test.ts`
- Test: `apps/production-ui/tests/historical-fill-lineage.test.ts`
- Create: `apps/production-ui/tests/live-history-contract.test.ts`

**Interfaces:**
- Produces `HistoryCoverage` with `status`, `source`, requested/completed/failed symbols, page counts, fill count, oldest/newest execution timestamps, local merge count, and refresh timestamp.
- Produces `UnifiedHistoryResult` from `live-history-contract.ts`: `{ entries: TradeHistoryEntry[]; source: "aster" | "local-fallback" | "empty"; coverage: HistoryCoverage; refreshedAt: string; error?: string }`.
- `loadAsterTradeHistory()` returns the existing fields plus `coverage`; callers may continue using `entries`, `source`, `refreshedAt`, and `error`.

- [ ] **Step 1: Write failing tests for coverage and fill identity**
  - Assert a 21-page, 1000-row-per-page sequence is fully paginated and not silently capped at 20 pages.
  - Assert a defensive page ceiling returns `PARTIAL` with a failed/diagnostic record instead of dropping rows silently.
  - Assert two fills with the same order ID and different trade IDs both remain in the merged output.
  - Assert HYPE (`hz-*`), Idle (`idle-*`), and Q102 (`q102v1-*`) markers classify correctly, while a symbol-only row is `UNATTRIBUTED`.
  - Assert `COMPLETE`, `PARTIAL`, and `UNAVAILABLE` coverage states are represented.

- [ ] **Step 2: Run the new tests and existing history tests to verify RED**
  - Run: `npx tsx --test apps/production-ui/tests/live-history-contract.test.ts apps/production-ui/tests/aster-account-history-consistency.test.ts apps/production-ui/tests/historical-fill-lineage.test.ts`
  - Expected: FAIL on the new coverage/partial-fill/Idle attribution assertions because the current implementation truncates, merges by order ID, and lacks the new contract.

- [ ] **Step 3: Implement the normalized source contract**
  - Add `"IDLE"` to the `TradeHistoryEntry.strategyId` union and add exact Idle/HYPE marker handling to attribution and fill-lineage parsing.
  - Define `HistoryCoverage` and `UnifiedHistoryResult` in `live-history-contract.ts`.
  - Expand the official symbol manifest with the configured production union, including HYPE/ZEC and Idle symbols, without inventing symbols from historical rows.
  - Change `fetchSymbolTrades(client, symbol)` to return rows, page count, and truncation/error metadata; continue with strictly increasing venue trade IDs until a short/no-new page, and mark the symbol `PARTIAL` if the defensive maximum is reached.
  - Change official history aggregation to retain per-symbol coverage failures while keeping successful symbols, and preserve the existing read-only position reconciliation.
  - Change trade identity so a present trade ID is the primary duplicate key; only use order ID as a fallback when no trade-level identity exists, preventing partial-fill collapse.
  - Keep the existing public `entries` shape and read-only behavior, including no Aster account call for unauthenticated requests.

- [ ] **Step 4: Run the focused history tests to verify GREEN**
  - Run: `npx tsx --test apps/production-ui/tests/live-history-contract.test.ts apps/production-ui/tests/aster-account-history-consistency.test.ts apps/production-ui/tests/historical-fill-lineage.test.ts`
  - Expected: all focused tests PASS, including 21+ page pagination, partial-fill preservation, attribution, and coverage states.

- [ ] **Step 5: Commit the history-source contract**
  - Run: `git add apps/production-ui/lib/server/trade-history-db.ts apps/production-ui/lib/trade-history-attribution.ts apps/production-ui/lib/server/fill-lineage-evidence.ts apps/production-ui/lib/server/aster-trade-history.ts apps/production-ui/lib/server/trade-history-source.ts apps/production-ui/lib/server/live-history-contract.ts apps/production-ui/tests/aster-account-history-consistency.test.ts apps/production-ui/tests/historical-fill-lineage.test.ts apps/production-ui/tests/live-history-contract.test.ts && git commit -m "feat(ui): make official history coverage and fill identity explicit"`

### Task 2: API, history page, performance page, and shared PnL input

**Files:**
- Modify: `apps/production-ui/app/api/system/trade-history/route.ts`
- Modify: `apps/production-ui/lib/server/live-performance-analytics.ts`
- Modify: `apps/production-ui/app/history/page.tsx`
- Modify: `apps/production-ui/app/performance/page.tsx`
- Test: `apps/production-ui/tests/live-performance-analytics.test.ts`
- Test: `apps/production-ui/tests/live-performance-ui-contract.test.ts`
- Test: `apps/production-ui/tests/trade-history-attribution.test.ts`

**Interfaces:**
- Consumes `UnifiedHistoryResult` from Task 1.
- Produces an API response retaining `entries`, `historySource`, `historyNotice`, `officialHistory`, and `readOnlyError`, plus authoritative `coverage` and `refreshedAt`.
- Produces performance/monthly/logic summaries from the exact same normalized `entries` supplied to the history page.

- [ ] **Step 1: Write failing tests for shared history/PnL and visible coverage**
  - Assert performance analytics uses official entries plus non-duplicate local complements, rather than dropping local fills whenever any official fill exists.
  - Assert monthly and logic summaries have the same entry count and attribution set as the history source.
  - Assert the API/UI contract exposes `coverage.status`, failed symbols, page counts, and refresh time.
  - Assert incomplete coverage is rendered as a visible warning and never as “全履歴取得済み”.

- [ ] **Step 2: Run the focused API/performance tests to verify RED**
  - Run: `npx tsx --test apps/production-ui/tests/live-performance-analytics.test.ts apps/production-ui/tests/live-performance-ui-contract.test.ts apps/production-ui/tests/trade-history-attribution.test.ts`
  - Expected: FAIL on the shared-source/coverage assertions because performance currently selects official-only data and the API has no coverage contract.

- [ ] **Step 3: Implement the shared history loader and visible coverage**
  - Route authenticated requests through `UnifiedHistoryResult`; keep unauthenticated requests local/read-only and mark coverage `PARTIAL` or `UNAVAILABLE` appropriately.
  - Refactor `loadLivePerformanceAnalytics()` to consume the same unified entries and coverage rather than independently selecting official-only history.
  - Keep net PnL preference: explicit net PnL, then realized PnL minus stable commission, otherwise no invented value; keep funding/unrealized values separate.
  - Add history coverage/source/refresh banners and failed-symbol details to the history and performance pages without removing existing tables, filters, calendar, or summaries.
  - Keep partial exits independent and preserve logic/route/exit-cause attribution.

- [ ] **Step 4: Run the focused API/performance tests to verify GREEN**
  - Run: `npx tsx --test apps/production-ui/tests/live-performance-analytics.test.ts apps/production-ui/tests/live-performance-ui-contract.test.ts apps/production-ui/tests/trade-history-attribution.test.ts`
  - Expected: all focused tests PASS with matching history/performance entry sets and visible coverage state assertions.

- [ ] **Step 5: Commit the history and PnL UI contract**
  - Run: `git add apps/production-ui/app/api/system/trade-history/route.ts apps/production-ui/lib/server/live-performance-analytics.ts apps/production-ui/app/history/page.tsx apps/production-ui/app/performance/page.tsx apps/production-ui/tests/live-performance-analytics.test.ts apps/production-ui/tests/live-performance-ui-contract.test.ts apps/production-ui/tests/trade-history-attribution.test.ts && git commit -m "feat(ui): align history and performance with complete fill coverage"`

### Task 3: Realtime logic-name contract and responsive rendering

**Files:**
- Modify: `apps/production-ui/lib/realtime-ranking.ts`
- Modify: `apps/production-ui/lib/server/realtime-ranking-observability.ts`
- Modify: `apps/production-ui/components/features/RealtimeRankingBoard.tsx`
- Test: `apps/production-ui/tests/realtime-ranking.test.ts`
- Test: `apps/production-ui/tests/realtime-ranking-show.test.ts`
- Test: `apps/production-ui/tests/realtime-ranking-sequence.test.ts`
- Test: `apps/production-ui/tests/realtime-full-gates.test.ts`

**Interfaces:**
- `RankRow` gains required `logicName: string` while retaining `logic: string` for compatibility.
- `loadRealtimeRanking()` continues returning `refreshSeconds: 30`, preview timing, rows, rank changes, and all existing read-only observability fields.

- [ ] **Step 1: Write failing tests for `logicName` and unchanged refresh behavior**
  - Assert every server-created row has the expected full logic name for V12, PENGU, Q102, FET, HYPE, Idle Short/Long, and V52.
  - Assert unknown/unsupported logic names remain explicit rather than empty.
  - Assert the response still advertises `refreshSeconds = 30` and preview timing, and existing rank movement/audio-related row IDs remain stable.
  - Assert the rendered board includes the full logic name/title/accessible label without removing score, rank, or gate display.

- [ ] **Step 2: Run realtime tests to verify RED**
  - Run: `npx tsx --test apps/production-ui/tests/realtime-ranking.test.ts apps/production-ui/tests/realtime-ranking-show.test.ts apps/production-ui/tests/realtime-ranking-sequence.test.ts apps/production-ui/tests/realtime-full-gates.test.ts`
  - Expected: FAIL on missing `logicName` and full-name rendering while existing ranking behavior remains covered.

- [ ] **Step 3: Implement the backward-compatible realtime contract**
  - Add a deterministic `logicNameForRuntimeLogic(logic)` mapping and populate `logicName` in the server row constructor from the VPS observability source.
  - Render `logicName` in top-three cards and all ranking rows; retain the existing `logic` field for speech/compatibility until callers are migrated.
  - Adjust only responsive grid sizing/ellipsis/title/ARIA attributes needed for full names; preserve 30-second polling, countdown, animation, sound, notifications, preview ranking, and score/rank separation.

- [ ] **Step 4: Run realtime tests to verify GREEN**
  - Run: `npx tsx --test apps/production-ui/tests/realtime-ranking.test.ts apps/production-ui/tests/realtime-ranking-show.test.ts apps/production-ui/tests/realtime-ranking-sequence.test.ts apps/production-ui/tests/realtime-full-gates.test.ts`
  - Expected: all realtime tests PASS, including full logic names and unchanged refresh/motion contracts.

- [ ] **Step 5: Commit the realtime UI contract**
  - Run: `git add apps/production-ui/lib/realtime-ranking.ts apps/production-ui/lib/server/realtime-ranking-observability.ts apps/production-ui/components/features/RealtimeRankingBoard.tsx apps/production-ui/tests/realtime-ranking.test.ts apps/production-ui/tests/realtime-ranking-show.test.ts apps/production-ui/tests/realtime-ranking-sequence.test.ts apps/production-ui/tests/realtime-full-gates.test.ts && git commit -m "feat(ui): show VPS-owned logic names in realtime ranking"`

### Task 4: Full UI verification, immutable VPS UI release, and read-only audit

**Files:**
- Modify: `docs/superpowers/plans/2026-10-19-hp-vps-runtime-history-plan.md` only for ledger/reference if required; no trading source files.
- Test: all Task 1–3 tests plus existing production UI test suite.

**Interfaces:**
- Consumes the committed UI changes from Tasks 1–3.
- Produces one Git SHA, one UI release marker, and read-only post-deploy evidence for realtime/history/performance. Trading runtime SHA, services, positions, orders, and risk state remain untouched.

- [ ] **Step 1: Run the complete relevant UI test suite**
  - Run: `npx tsx --test apps/production-ui/tests/*.test.ts`
  - Expected: exit code 0 with no failed tests. If unrelated legacy failures appear, record the exact test and reason before proceeding; do not hide them.

- [ ] **Step 2: Run TypeScript, lint, and production build**
  - Run: `npx tsc --noEmit -p apps/production-ui/tsconfig.json`; `npm --prefix apps/production-ui run lint`; `npm --prefix apps/production-ui run build`
  - Expected: all commands exit 0; build output is produced only inside the worktree.

- [ ] **Step 3: Inspect the final diff and commit**
  - Run: `git diff --check`; `git status --short`; `git log -1 --oneline`
  - Expected: no whitespace errors, only intended UI/spec/plan files changed, no secrets or large generated outputs staged.
  - Commit: `git add apps/production-ui docs/superpowers/specs/2026-10-19-hp-vps-runtime-history-design.md docs/superpowers/plans/2026-10-19-hp-vps-runtime-history-plan.md && git commit -m "feat(ui): align HP with VPS runtime and complete history"`

- [ ] **Step 4: Push and verify remote source**
  - Run: `git push origin codex/live-repair-rate-cert-20261019`; `git rev-parse HEAD`; `git ls-remote origin refs/heads/codex/live-repair-rate-cert-20261019`
  - Expected: local HEAD equals the remote branch HEAD exactly.

- [ ] **Step 5: Create and deploy an immutable UI-only VPS release**
  - Read-only inspect the current UI unit, current UI marker, current UI work directory, rollback release, and service name.
  - Build the release from the exact pushed Git SHA using the existing UI deployment contract; do not deploy from a dirty worktree and do not touch trading releases.
  - Preserve the previous UI release as rollback; switch only the UI current pointer/unit, with no trading service restart.

- [ ] **Step 6: Perform post-deploy read-only verification**
  - Check UI marker/working directory/PID/NRestarts and HTTP 200 for `/realtime`, `/history`, `/performance`, `/api/system/realtime-ranking`, and `/api/system/trade-history`.
  - Verify realtime response has `refreshSeconds: 30` and non-empty `logicName` for rows where observability exists.
  - Verify history response has `coverage.status`, requested/completed/failed symbols, page counts, and no false “complete” status.
  - Verify the UI release changed only HP behavior; orders sent, cancels, position changes, trading service PIDs, and Aster account state remain unchanged.

- [ ] **Step 7: Commit the verification ledger and report exact evidence**
  - Record command outputs, final Git SHA, UI release/rollback paths, service state, endpoint status, coverage state, and any remaining data-source limitations under `C:\Users\dis\Desktop\DisDex_AI_Files\03_VPS_LIVE` or `05_Logs_Audits` according to `AGENTS.md`; never save secrets.

