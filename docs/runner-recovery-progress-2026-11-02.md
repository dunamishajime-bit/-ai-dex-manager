# Runner recovery: progress and release boundaries

This is a source-work tracker, not a production approval or evidence that a
runner is allowed to trade. Source baseline: PR #304 head
`59d74dbaf69cc9e7c63f64859e706bb4513d28fd`. That branch is a draft, not
the production master. Owner approval must bind the final release, plan,
runner scope and order permission; this document cannot replace it.

| Work item | Status | Verification or remaining boundary |
| --- | --- | --- |
| Manual DOGE close | Reconciled previously; current position and open orders empty in signed GET | Historical reconciliation does not authorize a restart; the existing resume helper assumes the old position and STOP. |
| V4 | Production stopped | Old resume gate is incompatible with the manually closed position; PENGU peer dependency and independent order authorization also require resolution. |
| PENGU | Production stopped | An existing verify-only stage does not authorize starting the service. |
| FET hourly signal continuity | Source candidate | Tests cover missing/duplicate/malformed hours. Changes signal eligibility; economic review before LIVE. |
| PENGU timed-stop boundary | Source candidate | Tests cover exact three- and eight-hour boundaries. Changes exit timing; economic review before LIVE. |
| HYPE completed-bar freshness | Source candidate | Tests cover stale and fresh aligned bars. Changes signal eligibility; economic review before LIVE. |
| FET and Q102 owner SHA pins | Source candidate | Missing, malformed or mismatched independent pins block preemption. Production configuration and integration need separate certification. |
| AVAX sticky watch | Existing source candidate, not LIVE | Existing tests pass; do not duplicate or promote without approval. |
| Q102 managed STOP ownership | Open; source gate deliberately unchanged | Startup and runtime recognize different peers. Existing classifiers use order shape and ID patterns, not owner-ledger proof, so adding them to the admission gate would wrongly treat a lookalike as managed. Bind admission to verified owner evidence first. |
| V52 Gross and priority reductions | Reproduced in simulation; source fix in progress | Five preparation calls precede final admission, even with free capacity or when recovery is insufficient. A read-only, lock-protected recovery plan and later admission checks are required; do not promote a partial fix. |
| API saturation and account-lock contention | Open | Diagnose current production consumers and safe coordination; do not disable limits. |
| V4 evidence refresh and loader | Open | Verify release-local wiring, refresh-only authorization and fail-closed lease renewal. |
| HP, actual heartbeat, watchdog, all-runner audit | Open | Validate actual runner SHAs and authenticated UI, not only process liveness. |
| Final LIVE deployment and three audit cycles | Blocked | Needs certified plan, current signed venue evidence, owner approval and passing safety/economic gates. |

The production state and venue observations are time-sensitive; this tracker
is not a substitute for a fresh pre-deployment read-only audit. No order,
cancellation, position, STOP or Kill Switch change is authorized by this file.
