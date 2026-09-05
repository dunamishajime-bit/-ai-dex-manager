# Task 6 report — redacted four-strategy runtime status projection

Implemented the read-only runtime status projection and API.

- Added `lib/disdex-runtime-status.ts` with fixed heartbeat filename allowlisting, four-record normalization, stale/SHA/service-activity fail-closed handling, filename-to-runner binding, Q102 effective-symbol and cap projection, selector-parity metadata, and public-text/symbol redaction.
- Added a valid externally anchored release-SHA requirement: heartbeat self-attestation cannot produce `releaseShaMatch` or `LIVE` when both external SHA sources are absent or invalid; the public reason is non-secret and reports unavailable external identity.
- Added `lib/disdex-service-activity.ts` command-boundary injection with a bounded `systemctl` timeout and termination signal; timeout/command errors resolve to unavailable activity.
- Added `app/api/strategy/runtime-status/route.ts` as a dynamic no-store GET endpoint.
- Added fixture-only tests covering four records, inactive/unknown service safety, every cross-runner filename mapping, Q102 symbols/caps, absent/malformed/stale/SHA-mismatch safety, missing external release identity, bounded service-observer timeout handling, hostile symbol redaction, and no writes.
- No exchange client, order/write call, VPS, systemd, or deployment action was used.

Verification:

- `npx tsx --test tests/disdex_runtime_status.test.ts tests/disdex_service_activity.test.ts` — 12 passed, 0 failed.
- `npx tsc --noEmit` — passed.
- `git diff --check` — passed.
