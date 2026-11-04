# HP source-backed observation repair

V4 remains LIVE on 2a6f27c6. Monitor/watchdog source de1f1631 was certified in
separate no-order Root transactions without changing any Runner process,
approval, position, STOP, Kill state or current symlink. Snapshot cycles:
1793779559702, 1793779641864, 1793779744556. Watchdog cycles:
1793780079374, 1793780204709, 1793780267583. Its final non-audit run made no
restart requests; the timer now uses the canonical source with bounded recovery.

This follow-up replaces a permanently unavailable Gross placeholder with a
strict observation reader for existing Root-owned signed maintenance receipts.
It makes no new venue calls and grants no trading authority. Only a fresh flat
account/no-open-order proof, matching current pending bytes and actual immutable
V52 literal caps, can produce Gross 0 and available 3.0 crypto / 4.0 stock within
the 4.25 total ceiling. Evidence older than 120 seconds, any nonflat exposure,
new pending bytes, a malformed receipt or an unavailable policy remains unknown.
The same fresh flat proof permits NOT_REQUIRED_FLAT STOP display; it never
claims protection for a nonflat position.

Pending validation retains the existing five-minute freshness limit and rejects
null/string/nonfinite/negative gross/notional, unknown reservation status,
unreconciled UNKNOWN and future timestamps. Invalid pending is a monitor-side
order-permission block, not an exchange, Kill or runtime-state mutation.

Follow-up correction: the five-minute pending limit applies to unresolved
records, not closed RELEASED history. Terminal-only history reports zero pending
with its real timestamp and sourceFresh flag; it does not fabricate fresh venue
evidence. Gross and flat STOP display still require the separate current signed
receipt and exact pending digest. Future/invalid header timestamps and every
unresolved stale/UNKNOWN record remain rejected. This restores the prior LIVE
contract instead of adding a periodic timestamp dependency for closed history.

V4 observation rankings come from the actual Runner-owned gate telemetry, with
exact PID owner, runtime SHA, completed tick and freshness checks. Entry-source
rejections remain explicitly ineligible observations. The static 41-route count
does not claim all 41 were evaluated when the native entry source rejected a
symbol. Source/tick races remain unavailable for that observation cycle.

Verification before commit: 34 Node and 13 Python regressions passed. VPS
read-only reader preview obtained real flat Gross and exact current caps from
existing signed proof, without credentials in the preview environment. The
authenticated browser UI still requires an actual signed-in owner session;
Root data checks and anonymous HTTP are not counted as that verification.
# Peer same-PID loader migration prerequisite

Production audit confirmed all five legacy Node peers currently use a tsx CLI
MainPID; V4 already uses direct Node --import and V52 uses Python. New peer tick
source must not forge the CLI parent's PID. It requires a separately approved
same-PID release-local loader change plus state/activation/writable-path checks.

The watchdog previously accepted direct Node only for V4. Its actual matcher
failed the new five-peer fixture. Add strict per-runner script allowlist with
exact /usr/bin/node, own release loader, own full entrypoint and --daemon, no
extra flags. HYPE accepts TREND entrypoint only, never legacy sidecar. Existing
legacy command compatibility remains until real source+unit cutovers occur.
Eighteen watchdog/gate/audit-mode tests pass. This source change does not switch
any peer, grant permission or label legacy ticks verified. It needs CI and its
own immutable monitor transaction before future peer loader migration.

