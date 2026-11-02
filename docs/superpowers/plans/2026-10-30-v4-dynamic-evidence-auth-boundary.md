# V4 dynamic evidence refresh and auth-boundary plan

> Execute this plan in the isolated worktree.  Keep PR #302 deployment files,
> runner SHAs, the VPS, positions, STOPs, and Kill Switch unchanged.

## 1. Reuse and baseline

- [x] Inspect PR #303 head, merge base, files, CI, and deletion surface.
- [x] Cherry-pick only the three V4 commits onto the PR #302 line.
- [ ] Record the combined source SHA and confirm the PR #302 root gate remains
  present.

## 2. TDD: strict refresh command contract

- [x] Add failing tests for exactly-one `--verify-only`/`--apply`, unknown
  flags, missing SHA, and no mutation in verify-only mode.
- [x] Add the parser and mode contract to the refresh worker.
- [x] Add failing tests for root-owned refresh lease validation: schema, scope,
  target, SHA, expiry, `ordersEnabled=false`, and no order authority.
- [x] Implement lease validation without copying, retimestamping, or accepting
  a repository-side approval file.

## 3. TDD: production scheduler wiring

- [x] Add a root-only refresh service and a 30-minute timer that runs the real
  refresh helper, not the expiry watcher.
- [x] Keep the existing expiry watcher service/timer read-only and make the
  service contract reject monitor/refresh command substitution.
- [x] Add tests for service `ExecStart`, exact release SHA binding, timer
  ordering, `ProtectSystem`, `ReadWritePaths`, and no systemd runner restart.

## 4. TDD: API budget observability and bounded refresh

- [x] Add/extend tests for one ordered signed GET round, zero mutation methods,
  shared budget reservation, 429/418 behavior, cooldown/defer telemetry, and
  stale-snapshot rejection.
- [x] Add an 80-way contention test using an isolated temporary budget file and
  assert no lost updates, duplicate permits, or lock-owner ambiguity.
- [x] Verify the refresh worker's diagnostic output contains no credentials,
  signatures, private configuration, or venue secrets.

## 5. Verification and handoff

- [x] Run focused TypeScript, Node, and Python tests; run the existing PR #302
  safety tests without changing economic baselines.
- [x] Run `git diff --check`, source scans, and the V4 CI workflow locally where
  possible.
- [ ] Perform VPS read-only preflight only: no `systemctl start/stop`, no
  artifact creation, no evidence rewrite, no venue calls from this worktree.
- [ ] Push a new source branch and open/update a PR only after verification;
  do not merge, activate, or grant LIVE order permission.
- [ ] Report separately: source fixed, CI verified, VPS staged, VPS applied,
  owner authorization, and LIVE verification.  Do not claim the latter three
  without fresh evidence.
