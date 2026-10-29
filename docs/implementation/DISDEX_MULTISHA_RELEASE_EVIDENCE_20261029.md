# DisDex Multi-SHA Release Evidence Contract — 2026-10-29

Generator: `scripts/ops/root/disdex-multisha-release-evidence.mjs`

Schema: `disdex-multisha-release-evidence/v1`

The generator is a read-only source evidence tool. It hashes the safety-critical source files, records the current Git SHA, checks whether a regular local `.disdex-release-sha` marker exists, and emits explicit external-evidence blockers. It never creates the marker, changes an approval artifact, calls a venue, deploys a service, or authorizes orders.

## Required evidence fields

An operator activation artifact is not valid unless it independently supplies all of the following:

- exact `approvedSha`;
- exact target `professional-dismanager.net`;
- complete runner-scoped `approvedRunners` mapping;
- root ownership and least-privilege permissions;
- auditable approval timestamp;
- exact target release marker;
- runner-by-runner approval scope;
- preserved daily loss limit of `7.5%`;
- fixed Gross policy with dynamic allocation disabled.

The source generator reports `liveActivationGranted: false` when these are absent. A source checkout with no marker is classified `SOURCE_READY_NOT_LIVE`, not as a release.

## Safety invariants

The emitted evidence must keep these values unchanged:

```json
{
  "readOnly": true,
  "ordersSent": 0,
  "cancelSent": 0,
  "positionChangesSent": 0,
  "dynamicGrossAllocationEnabled": false,
  "dailyLossLimitPct": 7.5,
  "liveActivationGranted": false
}
```

The external evidence section explicitly carries `BLOCKED_OPERATOR_AUTH`, `BLOCKED_NATIVE_HISTORY`, and `BLOCKED_VENUE_EVIDENCE` until their independent requirements are met. The generator also records the required three post-cutover audit cycles and their completed count; a source checkout always reports zero completed cycles.

## Reproduction

From the isolated worktree:

```text
node scripts/ops/root/disdex-multisha-release-evidence.mjs --self-test
node scripts/ops/root/disdex-multisha-release-evidence.mjs
npx --no-install tsx --test tests/disdex-production-safety-release-evidence.test.ts
```

The expected self-test line is:

```text
DISDEX_MULTISHA_RELEASE_EVIDENCE_SELFTEST_PASS
```

The JSON output contains file SHA-256 values and no secret material. It should be attached to the repository/operations audit area only after checking that no credential or private configuration file is included.

## Non-goals

This evidence is not a substitute for:

- signed Aster GETs of balances, positions, STOP/TP, open orders, pending state, Gross, Margin Guard, Shared Risk, or Kill Switch;
- formal root-owned operator approval;
- the requested Aster-native historical dataset;
- production deployment, systemd restart, runner cutover, or post-cutover audit.

Until those gates are complete, no `LIVE_VERIFIED` claim is permitted.
