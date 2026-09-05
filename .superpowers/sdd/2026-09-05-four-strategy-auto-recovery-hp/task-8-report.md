# Task 8 report — CI and no-order runbook

## Delivered

- Added `.github/workflows/disdex-runner-health-ci.yml` with offline health/watchdog/status checks, Q102/V12/PENGU/V52 regressions, focused restart/status tests, typecheck, build, and static fail-closed/no-order assertions.
- Added `docs/implementation/disdex-four-strategy-auto-recovery.md` covering runtime states, read-only evidence, exact SHA/heartbeat identity, restart/reconciliation, rollback, safety-latch clearance, Q102 symbols/caps/selector contract, and zero-order proof.
- Added only the three requested `package.json` scripts:
  - `strategy:runner-health:selftest`
  - `strategy:runner-watchdog:selftest`
  - `strategy:runtime-status:test`

## Verification evidence

| Command | Result |
| --- | --- |
| `npm run strategy:runner-health:selftest` | PASS; `ordersSent=0 cancelSent=0 positionChangesSent=0` |
| `npm run strategy:runner-watchdog:selftest` | PASS; `restarts=0 ordersSent=0 cancelSent=0 positionChangesSent=0` |
| `npm run strategy:runtime-status:test` | First Windows run hit Node `spawn EPERM`; the closest repository-defined equivalent `npx tsx --test --test-concurrency=1 tests/disdex_runtime_status.test.ts` passed 11/11. |
| `npm run strategy:quality102-causal-v1:runner:selftest` | PASS; real/test/synthetic orders all 0 |
| `npm run strategy:v12-x1-all:selftest` | PASS; all constituent self-tests passed |
| `npm run strategy:pengu-dual-ls-v2:selftest` | PASS; orders/cancels/position changes false |
| `npm run strategy:disdex-v13d-v11eq-v96:contract` | Initial Windows esbuild child-process `spawn EPERM`; contract typecheck passed, and a direct rerun passed: `V96 + V52 margin-aware LIVE contract self-test: PASS`. |
| focused health/restart/status test command | PASS; 47/47 tests |
| `npx tsc --noEmit` | PASS |
| `npx next build` | PASS; 39 pages generated. Existing Browserslist freshness warning only. |
| `node -e ... JSON.parse(package.json)` | PASS; valid JSON |
| `git diff --check` | PASS |

The Windows `spawn EPERM` results were preserved as platform limitations; no test was weakened and no live/exchange operation was attempted. The workflow runs on Ubuntu 24.04, where the repository’s normal `tsx --test` and contract commands are retained exactly.

## Safety boundary

No deployment, VPS, systemd, exchange API, order, cancellation, modification, close, or live activation was performed. Existing unrelated untracked scratch and `__pycache__` artifacts were left untouched. The intended commit scope is the new CI workflow, runbook, this report, and the three package-script additions only.
