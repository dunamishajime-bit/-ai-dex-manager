# BT PR #481 — Resumable work checkpoint (2026-11-16 JST)

The active BT page worktree is intentionally isolated from Codex's STABLE4/V4 production worktree and LIVE execution. The scheduling automation is separate from the chat session and can run **at most once per hour**. Its existence does not guarantee that the computer is reachable, that execution resources are available, or that work finishes without a subsequent human action.

**Latest committed and pushed sha at checkpoint creation:** `799d106bbb39a6886d7d325b1c2e4efd0b42a1e0`; PR #481 remains OPEN/DRAFT.

Run `powershell -NoProfile -File scripts/bt-hp-resume-preflight.ps1 -Mode status` from this BT worktree to report head SHA, Git working state, active BT test processes and the next pending task. Use `-Mode verify` only on a clean worktree with no concurrent BT process to rerun the already source-verified V52 and Q102 fixtures. The script never invokes LIVE, SSH, VPS, orders, STOP, Kill Switch or production deployment.

**Task order** is in `BT_PR481_CONTINUATION_CHECKPOINT.json`; the next pending task is **BT-481-H**, a *source-only*, time-synchronized unified candidate observation ledger for HYPE/FET/IDLE/PENGU/V4/Q102/V52, ensuring that feature/grid threshold matches, shadow entry candidates, real models, fills, STOP and realized profitability cannot be conflated.

## Required continuation loop

1. Read **actual** `git status`, `git log -1`, branch and PR #481 remote HEAD/CI. If `HEAD` differs from JSON, the Git repository and pushed commit are authoritative. Search docs/tests to identify a task that was finished after this checkpoint rather than blindly repeating it.
2. Never run two writers on the worktree. If an in-progress test, uncommitted state, or concurrently editing agent is present, inspect/reconcile rather than resetting, deleting or overwriting it.
3. For each BT-safe task: implement isolated code, validate its inputs/no-lookahead/source SHA, run relevant regression and Next build, `git diff --check`, commit/Push on `feat/bt-visual-gross-20261114` **only after PASS**; then update the checkpoint status in a follow-up small commit if needed (one recorded task at a time).
4. If the PC disconnects, leave existing files and logs untouched; the next automation/check-in should reconstruct from PR head and committed files. Do not assume a command succeeded because it was submitted.
5. If a source input, genuine month-selector evidence, old ledger, or owner approval is missing, record as **blocked** and work on the next independent safe task without creating invented eligibility/trades/returns.
6. Keep PR #481 DRAFT until fully validated; **no** LIVE runner change, Codex branch write, production merge, SSH trade action, owner approval bypass, real-money execution or unapproved HP deploy.

The historical STABLE4_OPPORTUNITY ~13.54m-yen 10bps research result is from a separate historical research backtest, not reproduced by this synthetic BT page. A 22-day synthetic feature test or a source-native decision trace is not a six-month integrated trading PnL backtest.


## Task update after original checkpoint (2026-11-16)

BT-481-H2: source-only 7-family observation ledger complete and pushed at
`ba23fe3100c94cebf6c14bd2a7ded8f81692667d`. Exactly 8,260 rows,
source-candidate 54, verified executable entries 0, fills 0. Original
stage separation, source SHA, compressed full archive and causal cutoff
checked. Archived canonical ledger SHA
`b1a2714e028a11c2779ab0d430120be15a50bb1b6d8fb9bf83071d4727cd197b`.

BT-481-H3: fixed synthetic read-only source-evidence summary connected to
BT page, 7-family counts and stage warnings; component regression, TypeScript,
full Next.js build PASS. This is NOT a current user-selected synthetic run.
Owner/browser E2E, full V4 and 7-runner integrated economics remain pending.

The next uncompleted independent research task is **BT-481-I**. Do not
repeat H2/H3. Git remote head after the H3 commit/Push is authoritative,
not the original H2 checkpoint baseline.
