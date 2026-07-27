# Codex VPS Runner Task — Apply Prepared Split-Atomic Implementation

Work only on branch `codex/research-trade-history-sync-pr98`.

The complete GitHub-side split-atomic implementation has already been written and stored in a verified bootstrap bundle. Do not redesign it and do not manually recreate the files.

The previous applicator stopped safely because its archive SHA manifest was stale. That manifest has now been corrected and additionally pins the Git blob SHA of every `bundle.part00`–`bundle.part04`. Fetch the latest remote branch before retrying; do not reuse the older applicator from commit `c9379b3152483817eef0a8571a78bb5a089a4ea5`.

## First commands

```bash
git fetch origin codex/research-trade-history-sync-pr98
git checkout codex/research-trade-history-sync-pr98
git reset --hard origin/codex/research-trade-history-sync-pr98
git rev-parse HEAD
python3 ops/bootstrap/apply_split_atomic_bundle.py
```

Before extraction, the applicator must verify all of the following:

- current bundle archive SHA-256: `2a4c0dfd42aa8cc6e88ffc352126a37de9b9e2b864d689dae3d122ab9e1b3760`;
- fixed Git blob SHA for each bundle part;
- fixed allowlist of archive paths;
- no absolute paths, `..`, duplicate paths, symlinks, directories or other non-regular archive members.

The applicator must then:

- install the prepared workflows, scripts, fixed privileged-helper examples and migration documentation;
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
