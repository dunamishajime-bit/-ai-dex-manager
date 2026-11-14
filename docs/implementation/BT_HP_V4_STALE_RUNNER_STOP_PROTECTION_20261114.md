# BT #481: V4 LIVE observer failure and resident-STOP audit — 2026-11-14

## Scope and evidence

Read-only incident investigation for DisDex research/LIVE parity. The operator's V4 trading release was not restarted, edited or deployed. No order, cancel, STOP, Kill Switch, margin or position mutation was performed. No secret/private signed GET payload or trading ledger is committed.

- Production release: `795fefbbbb1c1176c80c7fd8391347578dadd0d5`
- Source files in the immutable VPS release, SHA256:
  - `lib/v12-v4-production-lifecycle.ts` = `8df7b367f777fa939e317fa88616173ce0ae9c9cdb7e15ce1e9302293dd4eb8f`
  - `lib/v12-v4-runner-engine.ts` = `d6173c39df8156cdd74b9fbad4a9d3060355d76368dc8f349ff1e60a14a4af0d`
  - `scripts/v12-v4-production-runner.ts` = `2dbd403ce093f08881a2351d4801428dc240d6aaf4501e80a6c54cbe424424e1`
- VPS `systemd` on 2026-11-14 around 20:00 JST: `disdex-v12-v4@795fefbb...` = `failed`, `ExecMainStatus=2`, latest transition at 19:15:11 JST.
- `journalctl`: 19:11:07 JST `submitted/DURABLE_ENTRY_WITH_RESIDENT_STOP`, followed by 19:15:11 JST fatal `V4_RUNNER_FAILED_CLOSED/ENTRY_LIVE_OBSERVATION_STALE_OR_REVERSED`.
- The ledger is revision 13605, release SHA matches the above, with a single OPEN V4 leg at failure time: `DOGEUSDT SHORT 301`, `REC_X05_TIME_36H`. Protect intent and protection-phase state recorded `STOP_CONFIRMED`.

## Independent Aster signed GET (read-only)

Two complementary signed **GET** checks returned a single venue position and its single resident stop. The inputs and full order ledger were retained privately on the owner's PC only.

| Field | Ledger | Signed venue GET |
| --- | --- | --- |
| Instrument/side | DOGEUSDT SHORT | DOGEUSDT SHORT |
| Open quantity | 301 | -301 signed positionAmount |
| Entry | 0.06294 USDT | 0.06294 USDT |
| STOP client order | `v12-v4-95d1f28b06eaedcb5939752030be` | same |
| STOP direction/type | BUY STOP_MARKET | BUY STOP_MARKET |
| STOP quantity | 301 | 301 |
| STOP trigger price | 0.06798 | 0.067980 |
| STOP status | STOP_CONFIRMED | NEW |
| reduceOnly | protective | true |

Read-only diagnostic reported `ordersSent=0`, `cancelsSent=0`, `positionChangesSent=0`, and no other exchange positions/orders at the observation. The offline validator in `scripts/bt_hp_v4_readonly_protection_audit.py` reconciles venue position + STOP order + stopPrice against ledger and supplied systemd snapshot, returning **`PROTECTED_BUT_RUNNER_NOT_RUNNING`** with exit code 2. This is a snapshot, not a continuous guarantee. Source documents, private full GET JSON and snapshot must never be placed in public HP or GitHub.

## Precise entry-timestamp failure surface

Production `lib/v12-v4-production-lifecycle.ts` rejects entry if `observedAtMs < eligibleEntryTs`, if `observedAtMs - eligibleEntryTs > 15 minutes`, **or** if the observation predates the last journal event. All three conditions share the error `ENTRY_LIVE_OBSERVATION_STALE_OR_REVERSED`; the fatal log alone does not reveal which predicate tripped.

Production `lib/v12-v4-runner-engine.ts` first captures `const now=this.now()` and skips candidates older than 15 minutes. However, it then performs awaited quote, minimum-notional, and required-stop lookups and calls `planProductionEntry` with a **later** `observedAtMs:this.now()`. A candidate accepted at 14m59s that completes preparation at 15m11s is rejected by the lifecycle, and the current catch rethrows this code, stopping the daemon. This is a concrete code-level TOCTOU hazard, consistent with the incident, but **not conclusively established** as the actual predicate because the error log omitted eligibleEntryTs, observedAtMs, and lastJournalTs.

Suggested source-controlled, isolated fix (NOT applied): recheck the exact timestamp window *after* awaited preparation and immediately before reservation. If it expired, return a non-ordering `V4_ENTRY_CANDIDATE_EXPIRED_DURING_PREPARE` admission hold, leaving all existing-position reconciliation and STOP management unaffected. Do not relax the lifecycle check or swallow genuine timestamp reversals. Add regression tests for cutoff crossing, duplicate candidates, reversed journal timestamps and post-stop priority, then push through owner-authenticated GitHub Actions before any production restart. Note this source currently exists in immutable VPS release artifacts; the source-controlled repository's BT branch does not own the full V4 lifecycle/runner engine implementation.

## BT implications and delivery boundary

The research BT assumes model-observed candle/position state, not the live runner's signed API rate-budget, tick timing, approval state, STOP ownership or downtime history. An apparent source SHA overlap alone cannot certify executable parity. V4 and HYPE historical run pins remain different from the current live units; latest V4 is **failed** rather than active. The correct BT status is `BLOCKED_FULL_LIVE_PARITY`.

VPS filesystem `/` remained 98% used (~1.4 GB free). No production deployment or research data upload was performed.