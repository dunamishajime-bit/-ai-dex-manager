# FET VOL10_RET15 candidate and production verification boundary

- Candidate source: d938b21231198df4c05120bbb2db0876397483b3.
- The former combined test depended on docs/production/current-live-target.json, which is absent from both this candidate and master. An October historical target is not a substitute for the current release.
- Candidate tests validate the actual config, the signal code consuming the upper bounds, and the health snapshot fields (min/max volume, min/max return, cooldown, maximum gross). The full 26-test FET candidate suite passed locally, with no venue requests.
- Production-only check: node --import tsx --test tests/fet-vol10-ret15-production-target.check.ts
- The production check preserves the original target and health assertions, additionally compares against actual runtime config, and returns nonzero if the target is missing. It is currently BLOCKED (ENOENT), not certified. The candidate CI does not claim to replace this check.
- Do not recreate a historical target as CURRENT_CANONICAL_PRODUCTION_TARGET, fabricate approval evidence, or enable orders. Current exact production release and root-authorized readback are still required.
