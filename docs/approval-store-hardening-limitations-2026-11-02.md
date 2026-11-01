# Approval store hardening: scope and outstanding safety work

This source-only change serializes file-backed writes made through the TypeScript
store, rejects stale file-backed updates and fails closed on unreadable or
malformed store contents. It does not authorize a deployment or change LIVE.

Outstanding blockers before treating the approval path as certified:

* The production approval and administrator sessions rely on fixed-value cookies.
  The administrator login's second-factor challenge is also client-controlled.
  Replace the authentication flow with a verified owner-identity boundary; a
  signed session alone must not turn an unverified challenge into an approval.
* Some older workflow scripts write the JSON file directly and do not acquire
  the TypeScript store's directory lock. They must be migrated to the same
  serialized, revision-checked protocol or retired only after a safe replacement
  is certified. This change does not protect against those writers.
* Redis updates are not compare-and-swap protected by this change. Multi-writer
  Redis approval operations remain uncertified; the existing atomic task-claim
  path deliberately fails closed for Redis.
* The existing owner-approved DOGE recovery plan assumes a protected open DOGE
  position. After the manual close it must not be reused for a flat-state
  restart. A new plan and exact-scope owner approval are required.
* Source tests and CI are not production installation, authenticated owner
  approval, exchange evidence, or a LIVE audit. Current services remain unchanged.
