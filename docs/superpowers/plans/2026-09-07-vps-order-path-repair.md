# VPS order-path repair plan

## Goal

Repair the verified production blockers without sending an order: make the stock reference gate classify US market holidays correctly, accept the active Alpaca reference health contract while retaining quote freshness checks during open sessions, and align the release/watchdog/health-snapshot/V52 state wiring to the current release. Then deploy the tracked change, restart only the current production services, run read-only reconciliation and mock/dry-run order-path tests, and report any remaining live blocker.

## Scope and safety constraints

- Preserve Kill Switch, account lock, stale-data gates, strict planner, reconciliation, daily risk, MTM reduction, and duplicate-order protection.
- Do not delete existing production state, force-close positions, cancel orders, or send synthetic, test, or real orders during migration.
- Treat missing or malformed reference data as fail-closed during an open US session; market closure only defers quote freshness until the next open session.
- Use the current release SHA discovered from `/home/deploy/disdex-trading/current`, not an old hard-coded release.

## Tasks

1. Add failing unit tests for US holiday/session classification and the two supported reference health contracts (Pyth/IEX and Alpaca). Run the focused tests and confirm they fail for the current implementation.
2. Implement a shared standard US equity holiday calendar and use it in the V52 free reference adapter and the Pyth/IEX reference proxy. Add a strict health-payload readiness helper that accepts the active Alpaca contract only when connected, while preserving the per-symbol freshness gate during regular sessions. Run the focused tests and the existing V52 self-tests.
3. Add a tracked root-only runtime-wiring repair/check script. It must resolve and validate the current release marker, generate highest-priority systemd overrides for watchdog and health-snapshot expected SHA/unit names, and point V52's legacy margin-state lookup at a readable shared path without touching positions or orders. Provide check/dry-run behavior and reject malformed or non-current release markers.
4. Commit the tests and implementation in reviewable units, push the branch, and wait for the resulting CI checks. Do not include generated caches or unrelated UI/research files.
5. On the VPS, run the wiring script in read-only check mode, apply only after the current SHA and target units are validated, reload systemd, and restart the current V12, PENGU, Q102, V52, margin-guard, and reference services in a controlled order. Do not start stale release instances.
6. Verify after restart: all current units are active without restart loops; watchdog and health-snapshot inspect the current SHA; V52 read-only preflight passes or remains explicitly fail-closed with a concrete external-market blocker; Q102 read-only preflight passes; positions/orders/managed-state reconciliation is unchanged; Kill Switch/account lock/risk state remain safe; and migration order counters remain zero.
7. Execute local mock/dry-run order-path tests for V12, PENGU, V52, and Q102, including duplicate prevention and strict gross caps. A real mainnet order test is out of scope until the user supplies an exact symbol, side, order type, maximum notional, and post-fill exit/cleanup authorization.

## Verification evidence required before completion

- Focused calendar/reference tests and existing strategy self-tests pass.
- Remote deployed release marker and all current service ExecStart/cwd values match the same SHA.
- Watchdog/health-snapshot effective environment points at that SHA.
- V52 and Q102 read-only preflight results are captured.
- No order, cancel, or position-change counters increase during repair/restart.
- Any claim of live readiness is limited by actual reconciliation and market-data evidence; never claim a real order was tested when only mock/dry-run was run.
