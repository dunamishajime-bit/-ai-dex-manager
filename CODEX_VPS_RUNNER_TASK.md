# Codex VPS Runner Task — Split Atomic Layout

Work on `codex/research-trade-history-sync-pr98`. Fetch and hard-reset to the current remote branch before reviewing.

Read in this order:

1. `docs/implementation/SPLIT_ATOMIC_VPS_MIGRATION.md`
2. `docs/implementation/PLUS_VPS_RUNNER_HANDOFF.md`
3. `docs/implementation/V52_CODEX_DIFF_REVIEW_HANDOFF.md`

The GitHub-side split-layout inspection, atomic release scripts, workflows, systemd preflight template, PM2/systemd examples and static tests are already implemented. Do not redesign them. Review for real defects and VPS-specific mismatches only.

Required local checks:

```bash
git fetch origin codex/research-trade-history-sync-pr98
git checkout codex/research-trade-history-sync-pr98
git reset --hard origin/codex/research-trade-history-sync-pr98
bash -n scripts/ops/vps-common.sh scripts/ops/vps-deploy-ui.sh scripts/ops/vps-deploy-trading-code.sh scripts/ops/vps-restart-trading-approved.sh scripts/ops/root/disdex-vps-control
node --check scripts/ops/vps-inspection.mjs
node --check scripts/ops/vps-trading-restart-gate.mjs
node --check scripts/ops/vps-ops-selftest.mjs
node scripts/ops/vps-ops-selftest.mjs
```

Current authorization is limited to:

- review and residual GitHub fixes;
- repository-dedicated runner registration when a short-lived GitHub registration token is supplied through the GitHub UI or another secure channel;
- repository-variable configuration without exposing secrets;
- installation of the fixed root-owned `disdex-vps-control` helper and an exact-path sudoers rule;
- read-only inspection.

Do not perform the one-time UI or trading service migration until the operator gives a new explicit approval. In particular:

- do not change PM2 cwd or reload the UI;
- do not install the live trading systemd drop-in;
- do not restart or stop `disdex-v96-v52-live.service`;
- keep `VPS_DEPLOYMENT_LAYOUT_MODE` unset;
- keep `VPS_ENABLE_APPROVED_TRADING_RESTART=false`;
- do not submit orders, change positions, clear Kill Switches or edit runtime state;
- do not merge or retarget PR #98.

Runner registration does not require GitHub CLI. If CLI is unavailable, stop and ask the operator to create a short-lived repository runner token from GitHub Settings. Never request that the token be pasted into a commit, issue, log or ChatGPT response.

Report the final SHA, any residual code changes, runner status, configured variable names, inspection artifact, and every remaining operation that requires separate human approval.
