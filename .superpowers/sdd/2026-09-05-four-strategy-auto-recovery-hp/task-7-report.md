# Task 7 report

## Changed files

- `hooks/useStrategyRuntimeStatus.ts`: shared runtime-status fetch hook with 60-second polling, refresh-event support, last-success retention, strict four-card payload validation, safe unavailable fallback, stale display projection, and parser-boundary Q102 normalization that ignores hostile state/caps and forces fixed non-executable output.
- `components/features/autotrade/StrategyRuntimeStatusPanel.tsx`: responsive four-strategy status cards and non-executable Q102 conditions/symbol view; every heartbeat-sourced Q102 symbol row now carries an API-derived fresh/fail-closed or `要確認`/fail-closed label, while stale retained cards remain ineligible with last-known context explicitly marked stale.
- `app/page.tsx`: mounts the shared runtime panel on home.
- `app/positions/page.tsx`: mounts the shared runtime panel on positions.
- `components/features/autotrade/LiveDecisionPanel.tsx`: adds a compact Q102 conditions anchor without changing decision math or history surfaces.
- `tests/strategy-runtime-status-ui.test.ts`: contract tests for API envelope parsing and safe state labels.

## Safety behavior

The UI consumes only `/api/strategy/runtime-status`; it does not infer LIVE from wallet or active-strategy state. Payloads are accepted only when they contain exactly the four allowlisted strategy IDs, unique records, and all required nested fields/types. HTTP, non-JSON, missing, malformed, and untrusted payloads produce a safe unavailable four-card model that includes Q102. Fetch failures retain the last successful response but project every card/panel operational state to `要確認`, force symbols non-executable, and mark retained reason/data as stale. Q102 remains `FAIL_CLOSED`/non-executable, shows `DERIVED_HIGH_VOL_ONLY`, 0.50x/2.00x/2.50x caps, unproven historical parity, and heartbeat-provided symbols only.

## Review round 2 fix

Structurally valid Q102 API records are normalized in the hook/parser path to `FAIL_CLOSED`, `LIVE_BLOCKED_FAIL_CLOSED`, `eligible: false`, and fixed 0.50x/2.00x/2.50x gross caps. The panel derives each Q102 row's freshness/safety label from the API item state and snapshot stale state; no duplicate symbol list was added.

## Verification

- `npx tsx --test tests/strategy-runtime-status-ui.test.ts tests/disdex_runtime_status.test.ts tests/disdex_service_activity.test.ts` — 17 passed, 0 failed (including adversarial Q102 LIVE/cap drift and fresh/stale per-symbol labels).
- `npx tsc --noEmit` — passed.
- `npx next build` — passed (39 static pages generated). Existing Browserslist freshness warning was emitted.
- No deployment, VPS, systemd, exchange, or order operations were performed.
