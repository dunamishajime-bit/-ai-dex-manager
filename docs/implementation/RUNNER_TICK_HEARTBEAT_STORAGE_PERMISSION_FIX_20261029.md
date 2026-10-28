# PR #299 follow-up — heartbeat storage permission / systemd sandbox

Observed on 2026-10-29 08:45 JST on Xserver VPS, **read-only**:
- /var/lib/disdex/runner-health is root:root 0755.
- /var/lib/disdex/runner-health/ticks does not exist.
- Active V4, Q102, PENGU, FET, V52, HYPE, IDLE run as deploy.
- Most units use ProtectSystem=strict and ReadWritePaths excludes the new ticks location (V52 ProtectSystem=full).
- PR #299's new TypeScript and Python writers default to /var/lib/disdex/runner-health/ticks, and attempt to mkdir as deploy. They cannot initialize a missing subdirectory under root-owned 0755. If rolled out unchanged, the new heartbeat source will be unavailable and health snapshot will mark valid runners BLOCKED; exceptions may break the loop.

Fix in operator-only runtime wiring:
- Under --apply and **after formal activation preflight**, create only the missing child directory with deploy:deploy 0700; do not chown the root health parent.
- Refuse an unexpected symlink, file or owner/mode mismatch (fail closed).
- Set a narrowly scoped systemd ReadWritePaths=/var/lib/disdex/runner-health/ticks via seven SHA-scoped unit overrides, leaving each runner's existing ReadWritePaths untouched.
- The existing wiring executes systemctl daemon-reload before any trading unit start. No source-level trading intent, daily loss, stop, gross or order algorithm change.
- Unit source contract tests 4/4 PASS; Git Bash syntax check PASS.

**Additional deployment restriction:** The current independently pinned V4 (53a0be...) and Q102 (ef1ab...) releases predate the new heartbeat instrumentation. Even with writable tick storage, a monitor that requires new tick markers must not claim these older binaries are healthy or auto-create fake markers. Codex must certify the exact lineage for each updated runner, keep the existing STOPs, and activate only if the genuine runner source emits the correct marker; otherwise fail closed/retain the old monitor until separate signed operator approval.

**No LIVE changes were performed by this patch.** This is intentionally a separate PR targeted at the in-progress heartbeat branch and should be incorporated by Codex after CI, before any LIVE promotion.
