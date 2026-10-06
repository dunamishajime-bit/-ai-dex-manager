# Formal Priority / Cooldown Production Contract — 2026-10-03

Status: **implementation branch / not deployed**

Base production SHA: `53eeff5417636369d4709fddfd47d7916ddcf3b1`

Official research reference: `docs/research/results/formal-priority-cooldown-20261003/formal-bt-summary.json`

## 1. Official BT baseline

The official comparison is the causal annual H1 price-model replay at **10 bps round trip**.

- Final equity: **JPY 1,229,065,462.0472791**
- Profit factor: **2.4887028036012624**
- Maximum MTM drawdown: **-21.296368751349548%**
- Win rate: **65.17647058823529%**
- Closed trades: **1,275**
- Accounting reconciliation: **PASS**
- Period: 2025-08-10 through 2026-08-10
- Initial contribution: JPY 10,000
- Monthly contribution: JPY 10,000
- Model: Aster H1/funding causal price model; **not historical L2 fill verification**

This replaces the earlier accepted-intent diagnostic replay as the production-change reference.

## 2. V12 sizing contract

Exposure targets at portfolio admission are fixed:

- Rank1 / Rank2: **Gross 1.00x**
- Rank1 / Rank2 for DOGE and LTC: **Gross 0.50x**
- Rank3: **Gross 0.50x**
- Rank3 is lower-priority residual only.
- Rank3 must not be admitted when a Rank1/Rank2 signal is simultaneously eligible.
- A later stronger V12 signal may close a held Rank3 and retry the same confirmed-bar opportunity.
- HC175 remains entry-quality/gate metadata; it no longer raises the formal portfolio Gross above the fixed target.

The exchange venue remains **5x Cross** for margin efficiency. 5x does not multiply strategy Gross or BT PnL.

## 3. Q102 -> V12 handoff contract

Only the following Q102 families may reclaim V12 capacity:

- `PB`
- `REV`
- `HIGH_VOL`

`MR` and `BRK` may **not** force-close V12.

When an authorized Q102 candidate is capacity-short of its requested Gross:

1. close V12 Rank3 first,
2. then Rank2,
3. then Rank1,
4. close only as many whole V12 positions as required to release enough current Gross,
5. reconcile each reduce-only exit against venue state,
6. re-run Q102 capacity planning using refreshed account/position/quote state.

Formal 10bps handoff observations:

- 19 V12 forced exits
- Rank1: 11
- Rank2: 8
- REV: 11
- PB: 5
- HIGH_VOL: 3
- MR: 0
- BRK: 0

## 4. Same-symbol cooldown contract

Cooldown is **per symbol**, not a portfolio-wide V12 freeze.

For every completed V12 exit path:

`cooldownUntil(symbol) = actual venue exit fill timestamp + 2 hours`

This applies to:

- explicit V12 exits,
- reconciled pending exits,
- resident STOP/TP fills found by between-bar reconciliation,
- resident STOP/TP fills found during restart reconciliation,
- Q102-priority V12 exits,
- Rank3 higher-priority preemption exits.

A confirmed protection fill without a verifiable venue fill timestamp must fail closed rather than deriving cooldown from `lastReferenceTs`.

The prior behavior using `lastReferenceTs + 2h` is not the formal contract because it can expire before the actual protection exit is reconciled and permit rapid same-symbol re-entry.

## 5. Cooldown sensitivity evidence

10bps causal H1 replay:

| Cooldown from actual exit | Final equity | PF | Max DD |
|---|---:|---:|---:|
| 2h | JPY 1,229,065,462 | 2.4887 | -21.30% |
| 4h | JPY 941,341,416 | 2.4814 | -21.30% |
| 6h | JPY 592,002,092 | 2.5032 | -21.30% |
| 12h | JPY 422,954,937 | 2.4764 | -21.33% |
| 24h | JPY 209,063,754 | 2.3825 | -21.50% |

Therefore the production fix is **correct 2h cooldown anchoring**, not a blanket extension to 4h/6h/12h/24h.

## 6. Deployment invariants

This branch is not authority to activate LIVE automatically. Codex deployment must:

- compile and run the affected test set before deployment,
- preserve operator activation gates and runtime-SHA ownership,
- deploy all cooperating V12/Q102 support code from one release SHA,
- migrate/read existing V12 state without deleting active position or protection metadata,
- prove resident protection remains present after rollout,
- prove no stale legacy global cooldown causes unrelated symbols to be blocked,
- verify Q102 MR/BRK cannot invoke V12 priority preemption,
- verify Q102 PB/REV/HIGH_VOL preemption is reduce-only and Rank3 -> Rank2 -> Rank1,
- verify actual fill timestamp is persisted before a preempted/exited symbol can re-enter,
- retain a rollback SHA and do not flatten healthy positions merely to deploy this change.
