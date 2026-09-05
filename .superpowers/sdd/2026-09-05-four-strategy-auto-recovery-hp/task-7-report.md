# Task 7 report

## Changed files

- `hooks/useStrategyRuntimeStatus.ts`: shared runtime-status fetch hook with 60-second polling, refresh-event support, last-success retention, and safe unavailable parsing.
- `components/features/autotrade/StrategyRuntimeStatusPanel.tsx`: responsive four-strategy status cards and non-executable Q102 conditions/symbol view.
- `app/page.tsx`: mounts the shared runtime panel on home.
- `app/positions/page.tsx`: mounts the shared runtime panel on positions.
- `components/features/autotrade/LiveDecisionPanel.tsx`: adds a compact Q102 conditions anchor without changing decision math or history surfaces.
- `tests/strategy-runtime-status-ui.test.ts`: contract tests for API envelope parsing and safe state labels.

## Safety behavior

The UI consumes only `/api/strategy/runtime-status`; it does not infer LIVE from wallet or active-strategy state. Fetch failures retain the last successful response and surface `要確認`. Q102 remains `FAIL_CLOSED`/non-executable, shows `DERIVED_HIGH_VOL_ONLY`, 0.50x/2.00x/2.50x caps, unproven historical parity, and heartbeat-provided symbols only.

## Verification

- `npx tsx --test tests/strategy-runtime-status-ui.test.ts` — 2 passed.
- `npx tsx --test tests/disdex_runtime_status.test.ts` — 11 passed.
- `npx tsc --noEmit` — passed.
- `npx next build` — passed (39 static pages generated). Existing Browserslist freshness warnings were emitted.
- No deployment, VPS, systemd, exchange, or order operations were performed.
