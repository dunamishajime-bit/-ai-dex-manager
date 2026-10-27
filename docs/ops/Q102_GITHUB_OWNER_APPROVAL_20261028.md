# Q102: GitHub manual owner-approved LIVE updates (2026-10-28)

## Status

The owner-only GitHub workflow is implemented. **It is not a completed VPS deployment and does not grant ChatGPT extra permissions.** There is no on-push or on-CI production mutation.

## User-controlled authorization

Only `dunamishajime-bit` may dispatch the workflow, and only from the default branch `master`. Input all three fields in **Actions → DisDex Q102 Owner-approved LIVE promotion → Run workflow**:

- `target_sha`: exact 40-character audited Git SHA.
- `expected_live_sha`: exact 40-character SHA observed on the currently active Q102 systemd service.
- `owner_approval`: `I_APPROVE_Q102_LIVE_<target_sha>`, exact string.

The owner must separately approve the `q102-production-manual` protected environment. The workflow verifies its GitHub Required Reviewers rule includes `dunamishajime-bit`, checks SHA ancestry/allowed Q102-only diff, and checks three successful **exact-target-SHA** CI results. All incorrect approvals fail closed.

## Required one-time manual setup

1. Merge workflow and validator into **master**. GitHub requires a manual workflow to exist in the default branch.
2. GitHub repository **Settings → Environments → q102-production-manual**: configure **Required reviewers** to include GitHub user `dunamishajime-bit`. Leave “Prevent self-review” disabled if the owner must both initiate and approve. The workflow fails if no such rule is present. GitHub Required reviewers are supported on public repositories.
3. Put `Q102_DEPLOY_HOST`, `Q102_DEPLOY_USER`, `Q102_DEPLOY_SSH_KEY`, `Q102_DEPLOY_KNOWN_HOSTS` in this GitHub **environment’s secrets**. Use least-privilege deploy SSH identity with restricted sudo. Verify and pin the host fingerprint independently. Never commit credentials or disable host-key checking.
4. The VPS must have a separately installed, auditable executable `/usr/local/sbin/disdex-q102-owner-approved-promote` supporting arguments `<target_sha> <expected_live_sha>`. It must itself fetch/check an immutable release, verify operator authorization and runtime ACK, approved 8-logic economics, authentic Aster venue exposure, protective STOP orders/readbacks, pending commands, Gross & Shared Risk, lock ownership, zero double-runner possibility, rollback, and final post-cutover systemd health. The GitHub workflow **does not install or weaken** that controller; without a proved controller it stops.
5. Run a non-mutating readiness audit of the real VPS before the first owner-authorized LIVE promotion.

## Deployment limits

This workflow currently supports only Q102-scoped changes, including its independent UI/CI and the existing corrected PENGU parity reference. It will refuse unapproved V12/PENGU/V52 trading logic changes. Other runners need equivalent separately reviewed workflows.

The global operator activation artifact remains mandatory. GitHub environment approval is an additional human authorization gate; it does not replace actual signed operator artifacts, live STOP evidence, or economic certification.

The historical 2026-10-22 integrated backtest does **not** certify the latest Q102 admission patch. Do not claim LIVE until exact release, operator and systemd/venue evidence all pass. No automatic retries of failed real-money promotion.
