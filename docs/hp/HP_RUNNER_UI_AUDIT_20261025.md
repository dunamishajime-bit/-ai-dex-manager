# HP UI and runner health audit — 2026-10-25

Scope: User-requested read-only frontend changes. No runner, order, risk policy, or strategy modifications.

- Remove the green, repeated production logic strip in the shared layout.
- Keep the dashboard compact; relocate detailed runtime policy display to /decision-status.
- Home screen presents release-pinned systemd statuses for V12 V4, PENGU, Q102, FET, HYPE, Idle, V52, Shared Risk and Margin Guard, with explicit failed/unknown status.
- Read-only authenticated /api/system/runner-health uses the current release marker. Historical unit failures from old SHA values are excluded.
- Decision status keeps per-runner expandable entry, protection, timeframe, provenance and reason fields.
- Fail closed when systemctl or current release marker cannot be read. Systemd RUNNING is not represented as exchange order readiness.

Audit evidence (read-only, 2026-10-25 JST):
- Current VPS release: 7688ed7c93a1918d8b44837339b7da5584a868f5
- Current V12 V4 unit: FAILED, Result=exit-code, exit=2.
- Current other 6 trading runners and two guards: active/running at time of check.
- Public professional-dismanager.net returned HTTP 200 for 22 sampled UI paths; three protected APIs returned HTTP 401 to an unauthenticated request.
- Current deployed Next.js route manifest contains more decision-status pages than the source branch. Do not production-cutover from this patch without full route-manifest, dependencies and LIVE API parity verification.

Deployment safety: maintain current UI until a full build, page route parity, logged-in E2E checks and rollback release have succeeded.
