# HP Live Status and Quality102 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every production UI page reflect the current V12, PENGU, V52, and derived Quality102 runtime state, including authenticated LIVE status and safe fail-closed explanations.

**Architecture:** Keep the UI read-only. Add a sanitized Quality102 observability reader, expose it through the existing decision-status API, render it in the shared decision panel and global banner, and inject only verified absolute state paths into the UI systemd environment. Preserve the existing trade-history source and do not change runner services or order state.

**Tech Stack:** Next.js 16, React 18, TypeScript, Node fs/promises, systemd, SSH.

**Spec:** User request: update all HP pages to current logic and repair LIVE state display.

## Global Constraints

- UI remains read-only: `tradingMutation=0`.
- No synthetic, test, or real orders are sent by this work.
- Existing runner services, positions, and open orders are not changed.
- Quality102 is the derived high-vol sleeve; historical selector parity remains fail-closed when unproven.
- Deploy through the XServer VPS, never Vercel.

### Task 1: Add failing observability contract tests

**Files:**
- Create: `tests/quality102-runtime-observability.test.ts`
- Modify: `lib/server/quality102-runtime-observability.ts`

- [ ] Write tests for sanitized caps, symbols, and unavailable behavior when the state path is absent.
- [ ] Run the focused test and confirm it fails because the module does not exist.

### Task 2: Implement Quality102 runtime observability

**Files:**
- Create: `lib/server/quality102-runtime-observability.ts`
- Modify: `app/api/system/decision-status/route.ts`

- [ ] Implement absolute-path validation, bounded JSON parsing, stale-state detection, heartbeat reading, and read-only sanitized output.
- [ ] Include cap values `0.50`, `2.00`, `2.50`, derived selector mode, symbol universe, parity flags, position, pending, and reason.
- [ ] Run focused tests and TypeScript checks.

### Task 3: Update all shared UI surfaces and current caps

**Files:**
- Modify: `lib/disterminal-live-config.ts`
- Modify: `components/features/DecisionStatusPanel.tsx`
- Modify: `components/layout/LiveProductionBanner.tsx`
- Modify: `app/page.tsx`
- Modify: `app/decision-status/page.tsx`
- Modify: `app/positions/page.tsx`

- [ ] Set the shared crypto cap to `2.00x`, current release metadata to the deployed runner release, and add the Q102 symbol/policy contract.
- [ ] Render Q102 status and symbols without claiming historical parity.
- [ ] Render authenticated runtime status consistently and retain mobile collapsible banner behavior.
- [ ] Run focused tests, typecheck, and production build.

### Task 4: Deploy and verify

**Files:**
- Remote: `/etc/disdex/ai-dex-manager-ui.env`
- Remote: `/home/deploy/disdex-trading/ui-releases/<immutable-release>`

- [ ] Back up the UI env, add only verified read-only state paths, build an immutable UI release, and restart only the UI service.
- [ ] Verify systemd status, current release, API payload, and logs.
- [ ] Reload the authenticated browser and verify `/`, `/positions`, `/decision-status`, `/performance`, and `/history`.
- [ ] Confirm no trading service, position, order, or Q102 runner state was mutated.
