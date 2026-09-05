# Task 7 report

## Changed files

- `hooks/useStrategyRuntimeStatus.ts`: shared runtime-status fetch hook with 60-second polling, refresh-event support, last-success retention, strict four-card payload validation, safe unavailable fallback, and stale display projection.
- `components/features/autotrade/StrategyRuntimeStatusPanel.tsx`: responsive four-strategy status cards and non-executable Q102 conditions/symbol view; stale retained cards are rendered as `要確認` with symbols ineligible and last-known context explicitly marked stale.
- `app/page.tsx`: mounts the shared runtime panel on home.
- `app/positions/page.tsx`: mounts the shared runtime panel on positions.
- `components/features/autotrade/LiveDecisionPanel.tsx`: adds a compact Q102 conditions anchor without changing decision math or history surfaces.
- `tests/strategy-runtime-status-ui.test.ts`: contract tests for API envelope parsing and safe state labels.

## Safety behavior

The UI consumes only `/api/strategy/runtime-status`; it does not infer LIVE from wallet or active-strategy state. Payloads are accepted only when they contain exactly the four allowlisted strategy IDs, unique records, and all required nested fields/types. HTTP, non-JSON, missing, malformed, and untrusted payloads produce a safe unavailable four-card model that includes Q102. Fetch failures retain the last successful response but project every card/panel operational state to `要確認`, force symbols non-executable, and mark retained reason/data as stale. Q102 remains `FAIL_CLOSED`/non-executable, shows `DERIVED_HIGH_VOL_ONLY`, 0.50x/2.00x/2.50x caps, unproven historical parity, and heartbeat-provided symbols only.

## Verification

- `npx tsx --test tests/strategy-runtime-status-ui.test.ts tests/disdex_runtime_status.test.ts tests/disdex_service_activity.test.ts` — 15 passed, 0 failed (including stale LIVE and malformed payload regressions).
- `npx tsc --noEmit` — passed.
- `npx next build` — passed (39 static pages generated). Existing Browserslist freshness warning was emitted.
- No deployment, VPS, systemd, exchange, or order operations were performed.
