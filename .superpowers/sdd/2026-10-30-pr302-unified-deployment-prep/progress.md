# PR #302 execution ledger

## Baseline

- Worktree: `.worktrees/pr302-unified-owner-approved-deployment-20261030`
- PR: #302
- Branch: `codex/unified-owner-approved-deployment-20261030`
- Starting remote HEAD: `31cfae65daabfbe07acd805925bc7c9e9db19c4d`
- Production mutations permitted: none
- Owner-only actions permitted: none

## Status

- [x] Isolated worktree created
- [x] Source and deployment contract audit
- [x] VPS read-only evidence audit
- [x] Dry-run and focused tests
- [x] Portable test fixes, if justified
- [ ] CI and branch push
- [ ] Final readiness report

## Evidence log

Record command, timestamp, scope, and result for every verification here. Do not copy secrets, private keys, or environment-file contents.

### Source and VPS findings

- PR #302 baseline remote HEAD: `31cfae65daabfbe07acd805925bc7c9e9db19c4d`; PR open, Draft, mergeable; baseline checks were green before local fixes.
- Current symlink read-only audit: `/home/deploy/disdex-trading/current` resolves to `7688ed7c93a1918d8b44837339b7da5584a868f5`; current and V4/Q102/V52 release directories are deploy-owned, so the root gate correctly rejects them as immutable root lineage.
- Active systemd readback: V4=`53a0be396719f0284af4e11b35c66a4ac7d58f79`, Q102=`ef1ab178e26a7bf5bddb6473467765edba242e1d`, V52=`97830672e2f139b39f7194166d7dc8c36e8c8933`, PENGU/FET/HYPE/IDLE/Shared Risk/Margin Guard=`7688ed7c93a1918d8b44837339b7da5584a868f5`.
- Root-owned unified-deploy inputs are absent: runner pins, current plan, owner public key, nonce/activation directories, and venue before/after evidence.
- Candidate `c9beb423ae9b6b18333ae9426a21a69cf35baeef` is root-owned with a marker and Shared Risk writer, but lacks the PR-302 root gate/deployment plan and is not an accepted immutable PR-302 target.
- Aster signed read-only diagnostic PASS: DOGEUSDT position `-226`; one reduce-only BUY STOP_MARKET quantity `226`, stop `0.086960`, client id `v12-v4-98ded39746ed3502a4d7b0e26ef9`; zero orders/cancels/position changes sent.
- Pending-exposure state was stale and had no trustworthy active count; it remains a formal preflight blocker.

### Test evidence

- `python -m unittest tests.test_v96_margin_guard_platform tests.test_vps_retention_dependency_protection tests.test_q102_1p0_lump100k_implementation_contract -v`: 10 passed, 5 POSIX-only symlink fixtures skipped on Windows.
- `python scripts/disdex_v96_v52_margin_guard_selftest.py`: PASS; fake client only, no venue access.
- `node scripts/ops/root/disdex-multisha-release-evidence.mjs --self-test`: PASS.
- Focused Python deployment/helper suite: 64 passed, 23 platform/crypto-library skips.
- `npx tsx --test` focused route-neutral, concurrency, heartbeat, manifest, and activation tests: 44 passed, 2 skips.
- `npx tsc --noEmit` and `npx tsc --noEmit -p tsconfig.research.json`: PASS after worktree dependency installation.
- `git diff --check`: PASS.
- `audit_legacy_deploy_paths.py`: read-only inventory complete; 10 VPS-access workflows, 9 legacy retirement candidates.

### Safety disposition

- No VPS files, symlinks, systemd units, orders, STOPs, positions, Gross, Shared Risk state, Margin Guard, or Kill Switch state were modified.
- Owner-signed token, activation artifact, and venue evidence were not created or synthesized.
- `OPERATOR_PREFLIGHT_READY`, `PRODUCTION_ACTIVATION_READY`, and `LIVE_VERIFIED` remain false pending root-owned lineage/input provisioning and owner authentication.
