# V4 new-SHA evidence preparation while old LIVE stays protected

Use the already owner-approved Root SSH implementation/deployment plan, inline
without subagents or repeat plan approvals. Target candidate c16859dc (120-second
account-ledger limit explicitly directed by owner on 2026-11-05).

The existing static producer writes /etc/disdex/v12-v4-evidence and the priority
recovery bootstrap assumes one obsolete recoverable HOLD. Neither is a safe
new-source staging command while the current 2a service is LIVE and Kill inactive.

- [ ] TDD: add an explicit Root-private audit output target to the static
  producer. Reject out-of-audit paths, symlinks, mutable/nonroot directories,
  wrong candidate basename and existing output files before tests or writes.
- [ ] Execute existing real release-local route/execution/typecheck commands;
  bind results to the exact immutable candidate SHA and command hashes. Staging
  output is new test evidence, never an operator activation or trading grant.
- [ ] Keep legacy publication API compatible; the new preparation route must
  write only the supplied trusted staging directory, leaving live evidence and
  certificates untouched. Test no-write-on-failure and real Root metadata.
- [ ] Run unit/full relevant control tests, CI, review and scoped helper install.
- [ ] Stage candidate source/dependencies with exact Git hashes, generate new
  evidence privately, and prepare a reviewed V4-only upgrade transaction. Current
  LIVE PID/SHA/approvals/STOP/Kill remain until that transaction is certified.
- [ ] New-source cutover must separately bind live baseline authority, current
  nine-SHA map, terminal durable migration, refreshed venue evidence, new genuine
  Root authorization, certificate/refresh scope, writable paths and rollback.
  Preserve inactive Kill; do not invoke obsolete-HOLD clearance as a shortcut.
