# V4 evidence expiry - preventive warning (2026-10-30)

SOURCE ONLY. NO LIVE DEPLOYMENT, NO RUNNER RESTART, NO ORDER OR STOP CHANGES.

This isolated branch is based on the trading development branch, not Codex's
PR #302 branch. It does not change the strict 24-hour authentication expiry.
Existing evidence must still be revalidated from original signed sources by
an authorized root operator. The monitor cannot renew, stamp or fabricate
evidence, and is not itself permission to enable new trading orders.

Root-owned V4 evidence has five independent timestamps. The oldest proof
controls when the bundle expires. The previous summary timestamp chose the
newest proof, understating the expiry risk. The existing strict gate still
rejects a stale proof.

The watcher reads all five root-owned, non-symlink, non-group-writable proof
files. It warns 12 hours before earliest expiration with exit code 3, and
reports expired/invalid proof with exit code 2. The optional systemd timer
can run every 30 minutes; it only starts the monitor, never V4. The timer
alone DOES NOT send emails. Hook up to certified alert/notification pipeline
and test alert delivery before relying on the warning.

Codex/operator follow-on:
- First read current V4 systemd, journal, current venue positions and STOP
  without changing state. 2026-10-30 13:03 JST email was a past snapshot.
- Find the root evidence producers and perform genuine read-only regeneration
  with exact SHA, signed Aster GET and root-approved operator identity.
- Identify any external watchdog forcibly starting V4 after fatal exit 2.
- Trace real Aster budget consumption across all runners and prioritize
  pending/STOP reconciliation within existing limits; never bypass cooldown.
- Stage and dry-run watcher separately from PR #302, then verify alert receipt.
- Trading authorization stays blocked until actual safety proofs pass and the
  owner approves a separate LIVE change.
