# V52 / IDLE Residual owner SHA reconciliation

On 2026-10-31, the live V52 runtime environment was verified read-only:
- DISDEX_RELEASE_SHA = 97830672e2f139b39f7194166d7dc8c36e8c8933
- DISDEX_IDLE_PRIORITY_RUNTIME_SHA = 7688ed7c93a1918d8b44837339b7da5584a868f5
- state file /var/lib/disdex/idle-priority/residual-long-state.json:
  schema disdex-idle-residual-long-state/v1 and runtimeSha
  7688ed7c93a1918d8b44837339b7da5584a868f5
- The V52 preemption helper previously used the V52 release SHA as if it
  owned the IDLE state. This deterministically raised
  IDLE_RESIDUAL_STATE_RUNTIME_OR_SCHEMA_MISMATCH and triggered Shared Kill Switch.

Change: the V52 preemption helper now requires the independently pinned
DISDEX_IDLE_PRIORITY_RUNTIME_SHA and uses that exact IDLE identity when
reading the state. Missing/invalid pins fail closed; it never infers
ownership from the state file. Trade/STOP preemption behavior is unchanged.

PRODUCTION STATUS: not deployed. The Shared Kill Switch remains active until
a separately approved root operator verifies all independent contributors and
runs the formal recovery protocol. Do not clear/relax the Kill Switch,
alter state JSON in place, or restart V4 just because the source tests pass.

This same common preemption utility is invoked by V12, PENGU, Q102 and FET.
The root-pinned IDLE SHA also takes precedence for these callers, so distinct
runner SHAs do not incorrectly claim ownership of the IDLE state. A missing
pin preserves the original strict check; an invalid nonempty pin fails closed.
