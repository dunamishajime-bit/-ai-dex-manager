# Pending-only committed maintenance

This extends the established root `CODEX_SSH` executor and the owner-signed
Actions contract with `PENDING_RECONCILE_ONLY`. It is not a Runner release and
must not change runner pins, UI/monitor pins, `current`, Kill, order authority,
positions or resident protective orders. `ordersEnabled` is always false.

The root-owned canonical plan freezes the existing nine Runner SHAs. The
separate source SHA identifies the reviewed immutable pending SDK. Root reads
the existing server credentials as data and drops the signed GET child to
`deploy`, using the normal account lock and shared API budget. No credential is
returned, put in an artifact or passed through GitHub.

After readonly preflight, approval expiry and exact bindings are rechecked.
The single-use deployment nonce is consumed and a new root-owned 0400 receipt
records the original approval times and its restricted operating authority.
This is not a copied or refreshed approval, nor an owner-signature claim for
root SSH. Its persistent authority permits only 60-second service-child grants
for this account, source, parent PID, receipt hash and pending registry hash.
Revocation blocks the next grant. Unknown, stale or partial ownership evidence
cannot justify registry freshness, and entries are never released by this SDK.

The first-install transaction publishes only its own receipt/service/timer,
then enables the timer. A failure removes those publications and never restarts
another Runner. Existing maintenance installations are refused; an upgrade
requires an explicit replacement transaction. An unused nonce is never restored
after failure. The helper does not change the global current-plan for this
component-only installation.

The service takes a shared global deployment lock; deployments hold the
exclusive side. A busy deployment defers reconciliation without HTTP or registry
writes. The service runtime is recreated root:deploy 0750 on reboot, preserves
the existing executor mutex, and uses a 90-second timer with at most 10 seconds
jitter. Errors are fail closed, report a separate supervisor heartbeat without
advancing last successful reconciliation, and trigger the existing failure alert.

Installation returns `PENDING_MAINTENANCE_INSTALLED_AWAITING_REAL_CYCLES`.
Three distinct scheduled signed-read results, unchanged entry data, no venue
mutations, frozen Runner identities and unchanged Kill must be audited after
the exclusive deployment lock has been released. These reconciliations do not
certify strategy ticks or trading LIVE. Root/Linux fixtures and CI are source
certification only; no actual Production success is asserted by this document.
