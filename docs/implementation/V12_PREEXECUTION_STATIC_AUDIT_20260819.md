# V12 pre-execution static audit — 2026-08-19

This note records pre-execution blockers and non-blockers found before the next production V12 activation attempt.

## Confirmed transport/control fixes

- trusted clone is `/home/deploy/ai-dex-manager`
- Git metadata ownership repair completed and deploy fetch succeeded
- forced-command installation completed
- direct constrained `CONTROL_PROBE` returned `DISDEX_VPS_CONTROL_PROBE_PASS`, `forcedCommand=TRUE`, `tradingMutation=0`, and remote `status=SUCCESS`
- the prior Windows failure was only a stale local success-string assertion
- resume-only path does not repeat Git repair, installer, or local probe

## Remaining dynamic fail-closed gates

The V3 production path intentionally blocks if any of the following is true at execution time:

- full-tree current/base/candidate audit reports `wouldBeLost > 0` or `overlapReview > 0`
- shared Kill Switch is active
- V96 state is bootstrap-required, pending, manual-review, or V96 Kill Switch active
- any BTC/ETH/BNB/SOL V96 position remains non-flat
- any BTC/ETH/BNB/SOL V96 open order/resident protection remains
- V12 state is active, pending, kill-switched, or manual-review
- PENGU V2 durable state and actual Aster PENGU position disagree, or PENGU has unresolved pending/open orders
- V52 durable state and actual stock positions disagree, or V52 has unresolved pending/open orders
- shared account lock cannot be acquired
- Aster credentials/connectivity/exchange rules are not ready
- V52 margin guard is not HEALTHY or minimum stock capacity is unavailable
- required runtime paths/systemd units/env files are missing

These gates must not be relaxed or automatically cleared.

## Timing-specific V52 observation

`regular_us_equity_session()` is weekday 09:30:00–16:00:00 America/New_York. During that window V52 readiness requires connected reference sources, healthy/fresh reference status, and fresh quotes. Outside that window quote freshness is explicitly deferred by the frozen production code, while source connectivity and the remaining readiness gates are retained.

For 2026-08-19 03:22 JST the equivalent New York time is 2026-08-18 14:22 EDT, so the freshness-required branch is active. Executing after the code-defined 16:00 New York boundary removes this transient freshness-only activation risk without weakening a gate.

## Final evidence contract

The V3 remote completion must emit and GitHub Actions must verify:

- `STATUS: LIVE_ACTIVATED_VERIFIED`
- `V96_V12_SIMULTANEOUS_LIVE=FALSE`
- `ORDERS_SENT_FOR_TESTING=0`
- `ARTIFICIAL_LIVE_ORDERS=0`

The local resume layer must not invent a success marker that was not verified in the remote log.
