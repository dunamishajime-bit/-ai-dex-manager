# V4 staged preview boundary

This preview starts from the Git tree for the currently pinned V4 SHA
`53a0be396719f0284af4e11b35c66a4ac7d58f79` and applies only the paths in
`deploy/v4-staged-overlay/manifest.json`. The builder refuses existing output
directories and never creates `.disdex-release-sha`. A composite preview is
not an immutable release or trading authorization.

Run `python scripts/ops/deploy/verify_v4_staged_preview.py` after installing
the repository's Node dependencies. It builds a temporary preview, checks
monitor-only and refresh behavior, validates V4 tick markers against the
supervisor, exercises 80 concurrent marker writes, and typechecks the preview.
The tick test is scoped to V4; it does not certify the peer runners.
The pending reconciliation helper is preview-only and rejects its apply mode
until a scoped executor has been implemented and certified.

Before a monitor-only deployment, a production release must be built from a
real reviewed Git commit, with its tree and release marker independently
verified. The root-owned tick directory and least-privilege API budget access
must be provisioned and tested. The proposed monitor and refresh units are
currently unable to update the shared budget while the shared directory is
read-only; disabling or replacing the shared budget is not an acceptable fix.
Fresh venue, pending and risk evidence, true decision ticks, rollback, and a
separate order-enabled activation remain required before LIVE.
