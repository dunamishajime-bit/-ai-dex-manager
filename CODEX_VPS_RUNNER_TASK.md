# Codex VPS Runner Task

Work on branch `codex/research-trade-history-sync-pr98` and fetch its current remote HEAD first.

Follow these documents in order:

1. `docs/implementation/PLUS_VPS_RUNNER_HANDOFF.md`
2. `docs/implementation/PLUS_VPS_RUNNER_LAYOUT_ADDENDUM.md`
3. `docs/implementation/V52_CODEX_DIFF_REVIEW_HANDOFF.md` for unchanged strategy/safety invariants

The GitHub-side workflows, request files, inspection/deployment scripts, rollback logic, restart gate and static self-test are already implemented. Do not redesign or rewrite them. Review the current code, fix only real defects or VPS-layout mismatches, then use the existing SSH access to install and configure the repository-dedicated `disdex-vps` self-hosted runner.

Required first commands:

```bash
git fetch origin codex/research-trade-history-sync-pr98
git checkout codex/research-trade-history-sync-pr98
git reset --hard origin/codex/research-trade-history-sync-pr98
bash -n scripts/ops/vps-common.sh scripts/ops/vps-deploy-ui.sh scripts/ops/vps-deploy-trading-code.sh scripts/ops/vps-restart-trading-approved.sh
node --check scripts/ops/vps-inspection.mjs
node --check scripts/ops/vps-trading-restart-gate.mjs
node scripts/ops/vps-ops-selftest.mjs
```

During this task:

- zero real orders;
- zero position changes;
- zero Kill Switch changes;
- zero direct runtime-state edits;
- zero production trading daemon restarts/stops;
- keep `VPS_ENABLE_APPROVED_TRADING_RESTART=false`;
- do not set `VPS_DEPLOYMENT_LAYOUT_MODE=in-place-reviewed` without verifying the live deployment layout; implement atomic releases instead if in-place build/reload is unsafe;
- do not merge or retarget PR #98.

Complete read-only inspection, a safe UI deployment test, and trading-code staging with authenticated no-order preflight. Return request templates to `enabled=false` after each one-time trigger. Push residual fixes and report the final SHA, runner configuration, workflow/artifact results, before/after PIDs and proof of all zero-mutation invariants above.
