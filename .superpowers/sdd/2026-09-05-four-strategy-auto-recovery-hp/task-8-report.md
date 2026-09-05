# Task 8 report — CI and no-order runbook

## Delivered

- Updated `.github/workflows/disdex-runner-health-ci.yml` to run Q102 signal/state self-tests, the maintained watchdog safety boundary, and path filters for all related scripts/tests.
- Added `scripts/disdex-runner-watchdog-safety-boundary.ts` plus `tests/disdex_runner_watchdog_safety_boundary.test.ts`; the AST boundary rejects exchange imports (including `require`/dynamic forms), bypassed or non-allowlisted systemctl calls, and order/lifecycle operations across multiline/computed forms without live calls.
- Updated `docs/implementation/disdex-four-strategy-auto-recovery.md` with the explicit PENGU_V8/V52 shared-unit mapping and required PENGU heartbeat plus shared PID/cwd/command evidence for both records.
- Retained the three existing Task 8 `package.json` scripts and added:
  - `strategy:runner-health:selftest`
  - `strategy:runner-watchdog:selftest`
  - `strategy:runner-watchdog:safety-boundary`
  - `strategy:runtime-status:test`

## Verification evidence

| Command | Result |
| --- | --- |
| `npm run strategy:runner-health:selftest` | PASS; `ordersSent=0 cancelSent=0 positionChangesSent=0` |
| `npm run strategy:runner-watchdog:selftest` | PASS; `restarts=0 ordersSent=0 cancelSent=0 positionChangesSent=0` |
| `npx tsx scripts/disdex-runner-watchdog-safety-boundary.ts` + `npx tsx --test --test-concurrency=1 tests/disdex_runner_watchdog_safety_boundary.test.ts` | PASS; static boundary and 4/4 boundary tests passed; no live calls. The npm wrapper hit the known Windows `spawn EPERM`; Ubuntu CI uses the same npm script. |
| `npm run strategy:quality102-causal-v1:signal:selftest` | PASS |
| `npm run strategy:quality102-causal-v1:state:selftest` | PASS |
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
