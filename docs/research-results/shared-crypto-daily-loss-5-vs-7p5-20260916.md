# Shared Crypto Daily Loss 5% vs 7.5% Investigation — 2026-09-16

## Scope

This document records the evidence used to evaluate the DisDex shared crypto daily-loss gate. This commit is documentation/research evidence only. It does not change LIVE, VPS, orders, positions, gross caps, or strategy signals.

Production base inspected: `10e18fea89b2aa889b9ce3d6a2603c43ac9e7715`.

## Git lineage finding

The 7.5% shared-loss policy was explicitly implemented on 2026-08-20:

- `672ba26bbd10b8b55b45724297c4d1921fd3f50a` — PENGU shared daily-loss cap raised from 5% to 7.5%.
- `94a8dea06ad8cb196867d13912fc58cffd4010d0` — shared-risk writer changed from hard-coded 5% to configurable `DISDEX_SHARED_CRYPTO_MAX_DAILY_LOSS_PCT`, default 7.5%.
- `4c6fc12595f5f667f7e8447c519f09f951f2e803` — shared-risk self-test aligned to 7.5%.
- `49367079cd6790d5c29c190e9066f4444a3332be` — systemd policy explicitly set `DISDEX_SHARED_CRYPTO_MAX_DAILY_LOSS_PCT=7.5`.

Those four commits are not ancestors of the 2026-09-04 Quality102 LIVE connection commit `afd9244401e1738e4559e58c06091f3d543b237e`. That Q102 lineage recreated the shared-risk writer with a 5% default and added Q102 to the shared strategy set. The evidence therefore supports a lineage/configuration rollback, not a later 5%-vs-7.5% comparison that selected 5%.

The 2026-09-11 implementation handoff records 5% as the then-current shared condition, but its research contract fixed the gate at 5%; it did not compare 5% against 7.5%.

## Current LIVE observation before any change

Read-only inspection of the production VPS on 2026-09-16 showed:

- Current release: `10e18fea89b2aa889b9ce3d6a2603c43ac9e7715`.
- Shared-risk service: active/running.
- State `maximumLossPct`: `5`.
- State strategy set: V12 + PENGU + Quality102.
- State `tripped`: `false` at inspection time.

## Backtest comparison — ¥130,000 DCA contract

| Scenario | 5% Shared | 7.5% Shared | 7.5% delta |
| --- | ---: | ---: | ---: |
| NORMAL ending asset | ¥16,876,462.71 | ¥18,442,769.04 | +¥1,566,306.33 (+9.281%) |
| NORMAL PF | 3.54149451 | 3.57064393 | +0.02914942 |
| NORMAL max DD | -14.33740242% | -14.33740242% | unchanged |
| SEVERE ending asset | ¥2,607,832.87 | ¥2,827,282.14 | +¥219,449.27 (+8.415%) |
| SEVERE PF | 2.39378839 | 2.41551514 | +0.02172675 |
| SEVERE max DD | -18.46507481% | -17.68170098% | improved 0.78337383 pt |

Both cases passed the research-only contract checks. Under NORMAL, 5% created 8 daily-loss latches, blocked 5 V12 entries and 4 Q102 entries; 7.5% created 1 latch and blocked no later entry. The direct missing-event PnL explains about ¥313,587 of the NORMAL gap; about ¥1,252,720 is downstream compounding/sizing propagation.

## Backtest comparison — ¥100,000 lump-sum contract

Using the same current shared-risk semantics with Q102 included:

| Scenario | 5% Shared | 7.5% Shared | 7.5% delta |
| --- | ---: | ---: | ---: |
| NORMAL ending asset | ¥60,678,084.97 | ¥71,552,183.68 | +¥10,874,098.71 (+17.921%) |
| NORMAL PF | 3.46233145 | 3.50828962 | +0.04595817 |
| NORMAL max DD | -14.33740242% | -14.33740242% | unchanged |
| SEVERE ending asset | ¥6,172,183.54 | ¥7,137,081.50 | +¥964,897.96 (+15.633%) |
| SEVERE PF | 2.34926076 | 2.38172991 | +0.03246915 |
| SEVERE max DD | -19.94193393% | -19.17274951% | improved 0.76918442 pt |

## Operational conclusion

The tested evidence does not show a benefit to retaining 5% in the current V12/PENGU/Q102 shared-risk architecture. In both capital schedules and both NORMAL/SEVERE scenarios, 7.5% improved ending asset and PF while maximum drawdown was unchanged or better. This is historical/research evidence, not a guarantee of future profit.

Any LIVE change must update the entire contract atomically: shared-risk writer, systemd/env, PENGU runtime, Quality102 runtime, V12/shared-risk validation and self-tests, observability/UI labels, deployment/preflight contracts, and restart reconciliation. Gross caps, signal definitions, Kill Switch behavior, stale-data fail-closed behavior, and ownership/reconciliation rules must remain unchanged.
