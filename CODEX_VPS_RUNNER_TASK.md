# Codex VPS Runner Task — Apply Prepared Split-Atomic Implementation

Work only on branch `codex/research-trade-history-sync-pr98`.

The complete GitHub-side split-atomic implementation has already been written and stored in a verified bootstrap bundle. Do not redesign it and do not manually recreate the files.

## First commands

```bash
git fetch origin codex/research-trade-history-sync-pr98
git checkout codex/research-trade-history-sync-pr98
git reset --hard origin/codex/research-trade-history-sync-pr98
python3 ops/bootstrap/apply_split_atomic_bundle.py
```

The applicator must:

- verify the fixed SHA-256 of the bundle;
- reject unexpected or unsafe archive paths;
- install the prepared workflows, scripts, fixed privileged helper examples and migration documentation;
- run shell syntax checks, Node syntax checks, the VPS operations self-test and `git diff --check`;
- delete the temporary bundle and applicator;
- commit and push `Adopt split atomic VPS release layout` to the same branch.

After it pushes, refresh the branch again:

```bash
git fetch origin codex/research-trade-history-sync-pr98
git reset --hard origin/codex/research-trade-history-sync-pr98
```

Then follow the newly installed files in this order:

1. `CODEX_VPS_RUNNER_TASK.md`
2. `docs/implementation/SPLIT_ATOMIC_VPS_MIGRATION.md`
3. `docs/implementation/V52_CODEX_DIFF_REVIEW_HANDOFF.md`

## Hard safety boundary for this pass

- zero real orders;
- zero position changes;
- zero Kill Switch changes;
- zero direct runtime-state edits;
- zero production trading daemon stops or restarts;
- zero UI reloads until a separate explicit migration approval;
- do not set `VPS_DEPLOYMENT_LAYOUT_MODE=in-place-reviewed`;
- keep `VPS_ENABLE_APPROVED_TRADING_RESTART=false`;
- do not merge or retarget PR #98.

The inspected layout is not safe for in-place deployment. The prepared implementation uses separate exact-SHA UI and trading release roots and intentionally fails closed until PM2 and systemd are explicitly migrated to their respective `current` symlinks.

If runner registration or Repository Variables cannot be completed because no GitHub registration token or authenticated GitHub administration path is available, stop safely and report the exact remaining manual UI steps. Never request that a token, `.env`, API key or private key be pasted into GitHub source, logs or chat.
