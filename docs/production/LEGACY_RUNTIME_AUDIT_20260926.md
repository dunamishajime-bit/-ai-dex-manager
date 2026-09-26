# Legacy runtime audit — 2026-09-26

This note records the read-only legacy/runtime audit performed against the XServer
Production host. It is an audit record, not a request to promote or activate a
runner.

## Scope

The following named contracts remain historical or compatibility contracts and
were intentionally not rewritten as part of the current integrated runtime
hardening:

- `STRICT_BT33404708902`
- `DISDEX_V96` / `DISDEX_V13D_V11EQ_V96`
- old research backtests and their frozen inputs
- historical GitHub Actions workflows and formal-parity assertions

These names are not, by themselves, evidence that the corresponding trading
runner is live. Current production identity is determined by the exact
SHA-pinned systemd instance and its release marker.

## VPS evidence

The audit observed the following current release on the Production host:

- `current` → `/home/deploy/disdex-trading/releases/e1b58060d6263a3af7ced51bec854d3e211d2f35`
- `.disdex-release-sha` = `e1b58060d6263a3af7ced51bec854d3e211d2f35`

The active SHA-pinned trading/safety units were:

- `disdex-v12-x1-all@e1b58060d6263a3af7ced51bec854d3e211d2f35.service`
- `disdex-pengu-dual-ls-v2@e1b58060d6263a3af7ced51bec854d3e211d2f35.service`
- `disdex-quality102-causal-v1@e1b58060d6263a3af7ced51bec854d3e211d2f35.service`
- `disdex-fet-brk48@e1b58060d6263a3af7ced51bec854d3e211d2f35.service`
- `disdex-v52-aster-only@e1b58060d6263a3af7ced51bec854d3e211d2f35.service`
- `disdex-shared-crypto-risk@e1b58060d6263a3af7ced51bec854d3e211d2f35.service`
- `disdex-v12-v52-margin-guard@e1b58060d6263a3af7ced51bec854d3e211d2f35.service`

No active `v96`, `v13d`, `v46`, `strict`, or other legacy trading service was
observed. The old legacy unit files remain installed but were inactive,
disabled, static, or masked. They are retained for rollback/research
compatibility and must not be interpreted as active production runners.

The following active support processes were separately classified as non-trading:

- decision gateway (read-only advisory)
- research commander and its read-only tunnel
- GitHub Actions runner
- stock reference service

The research commander must not be stopped merely because its name is present;
its role is read-only research/support and it is not an Aster execution path.

`node_modules` and `.venv2` for the current release resolve to the release
`7e80cf8a4458f6f6fe9316aa144c1d743ef51a93` and both dependency targets have
their own matching release markers. This is dependency lineage, not a second
active trading release. The current-runtime wiring now records and validates
these source SHAs rather than silently treating them as the current runtime.

`systemctl --failed` was empty at audit time. Old standalone read-only diagnostic
processes from prior releases were terminated by exact PID after confirming they
were outside the current trading cgroups; current e1 trading processes were not
touched.

## Safety conclusion

- legacy trading runner active count: `0`
- current e1 trading/safety unit lineage: coherent
- failed DisDex/Aster-related systemd units: `0` at audit time
- no order, cancel, or position mutation was performed by this audit

The legacy source files and historical contracts should remain available for
research and rollback. Any future promotion of a legacy runner must be a
separate, explicit, SHA-pinned operator-reviewed deployment.

## Historical test classification

Running `npm run strategy:strict-bt33404708902:contract` against the current
integrated planner produces two expected assertion failures: those assertions
compare the historical contract's `totalGrossCap=3.5` with the current
Production integrated cap of `4.25`. The named `STRICT_BT33404708902` source,
its historical workflow, and its frozen assertions were not rewritten. This
test must therefore remain a historical/legacy parity check and must not be
used as the current Production health gate. The current Causal V4 Q102 portfolio
suite is the current runtime contract and passed `17/17` in this audit.
