# HP UI/UX Redesign Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the committed DISTerminal cockpit UI/UX while preserving the current V12, PENGU Dual LS V2/Recovery V8, V52 observability, and read-only safety behavior.

**Architecture:** Reintroduce the UI presentation primitives (`DecisionUi`), the client decision-status hook, and the decision view-model from the verified redesign branch. Keep the current server observability payload and its V52 reference-freshness gate authoritative; adapt only the presentation boundary where the current payload differs.

**Tech Stack:** Next.js 16, React, TypeScript, Tailwind CSS, lucide-react, Node self-tests, XServer VPS systemd deployment.

**Spec:** `origin/codex/ui-terminal-redesign-20260827` at `c3b82ac91c5c72e6c936fdd63d28ca85e43d00ab` is the UI/UX source of truth; current HEAD `33a1429dab8f829fbe5a90b740da0c85644086b5` is the runtime-observability source of truth.

## Global Constraints

- Vercel is not used; deploy the HP only through `professional-dismanager.net` over SSH as `root` using `C:\Users\dis\Desktop\DisDex.pem`.
- Preserve V12/PENGU/V52 runtime logic, Recovery V8 parameters, Fail Closed, Kill Switch, `readOnly=true`, and `tradingMutation=0`.
- Do not send, cancel, settle, or test any order; do not restart trading Runner services during UI deployment.
- Do not print or commit private keys, credentials, or VPS environment secret values.

### Task 1: Regression guard for redesign presence

**Files:**
- Test: `scripts/ui-ux-redesign-presence-selftest.mjs`

- [x] **Step 1: Write the failing test** that requires the three redesign modules and the redesigned home-page bindings.
- [x] **Step 2: Run the test to verify it fails** with `UI_UX_REDESIGN_MISSING` on current HEAD.

### Task 2: Restore presentation layer

**Files:**
- Restore from redesign source: `components/features/DecisionUi.tsx`, `hooks/useDecisionStatus.ts`, `lib/ui/disterminal-ui-view-model.ts`.
- Modify: `app/page.tsx`, `app/decision-status/page.tsx`, `app/positions/page.tsx`, `components/features/DecisionStatusPanel.tsx`, `components/layout/TopBar.tsx`, `components/layout/LiveProductionBanner.tsx`.
- Preserve current server boundary: `app/api/system/decision-status/route.ts`, `lib/server/pengu-runtime-observability.ts`, `lib/server/v52-top2-observability.ts`, including `V52_REFERENCE_HEALTH_URL` support.

- [ ] **Step 1: Apply the redesign presentation changes** from `c3b82ac9`, resolving conflicts in favor of the current live snapshot types and reference-freshness gate.
- [ ] **Step 2: Keep the V52 stale/reference-block reason visible** in the redesigned cards and detail panel.
- [ ] **Step 3: Run the redesign presence self-test** and confirm `UI_UX_REDESIGN_PRESENT`.

### Task 3: Verify and publish

**Files:**
- Test: `scripts/ui-ux-redesign-presence-selftest.mjs`.
- Build output: `.next/` (not committed).

- [ ] **Step 1: Run** `git diff --check` and `npx tsc --noEmit -p tsconfig.json`.
- [ ] **Step 2: Run** `node scripts/ui-ux-redesign-presence-selftest.mjs` and `npx next build --webpack`.
- [ ] **Step 3: Commit only the UI/UX restoration files and test, then push the branch.**
- [ ] **Step 4: Deploy a new immutable UI release to `/home/deploy/disdex-trading/ui-releases/<full-sha>` and set `V52_REFERENCE_HEALTH_URL=http://127.0.0.1:8797/health` in the UI drop-in.
- [ ] **Step 5: Restart only `ai-dex-manager-ui.service`, verify the new working directory, and query the read-only decision-status API.
- [ ] **Step 6: Verify all Runner services remain active, Kill Switch is inactive, shared risk is not tripped, and no order/cancel/settlement/test mutation occurred.
