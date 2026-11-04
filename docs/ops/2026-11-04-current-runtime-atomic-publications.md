# Current runtime atomic publication repair

Baseline: actual V4 LIVE source 2a6f27c6d2896aee420cbc44fe1ab8103750376c.
This branch changes only temporary-file identity and exclusive creation in five
shared libraries. It does not change entries, exits, ranking, routes, thresholds,
Gross, STOP ownership, reservations, account locks, budget intervals, priorities,
cooldowns, proxy routing or durable state schemas.

The already implemented safety pattern in Shared Risk source 2737c30e is reused
as minimal hunks. Copying whole libraries from that older source would remove
current V4 broker support and current IDLE/RENDER state validation. Those whole
file replacements are explicitly excluded.

## Evidence

On the VPS, a private test fixture copied only public source from immutable
2a6f27c6, with no credentials and no venue calls. Eighty publications at one PID
and a fixed millisecond reproduced temporary rename collisions for IDLE,
residual, HYPE and daily risk. Four tests failed; the shared-budget serialization
test passed. Root-private red log:
`/var/lib/disdex/ops-audit/resume-7b5058a9-82ec7885/v4-common-concurrency-red/red.log`.

After UUID names and exclusive creation, the five regressions and existing
budget/proxy/permission/STOP/lifecycle/reservation/state tests passed 119/119,
without skips. The fixtures required the original public source dependencies;
initial incomplete fixture runs failed for absent modules and were corrected,
not hidden or counted as successful tests. Green log:
`/var/lib/disdex/ops-audit/resume-7b5058a9-82ec7885/v4-common-concurrency-green/broad-green.log`.

The frozen preview lineage check now permits exactly two explicit publication
changes in the shared-budget file. Every other byte, including all proxy and
budget enforcement code, must still equal the reviewed preview. All three
lineage tests pass. CI adds the current-runtime regressions to the full existing
V4 candidate suite.

## Production boundary

This source repair is not yet a runtime cutover. V4 remains LIVE on 2a6f27c6;
the existing Shared Risk Writer remains 2737c30e. The current Q102, V52 and
7688 peer sources also contain older publication implementations. Each needs
the same minimal hunks against its own exact baseline, appropriate testing,
immutable release and scoped authority before any new runtime pin is adopted.
Do not edit installed immutable libraries, blanket replace independent runner
SHAs, or reuse old authorization artifacts for the future candidate SHA.
