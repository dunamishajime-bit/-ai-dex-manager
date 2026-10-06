# PENGU M05 Shadow Contract — 2026-10-07

Status: **RESEARCH / TELEMETRY ONLY / MUST NOT CHANGE ORDERS**

## Purpose

Collect forward evidence for the only material PENGU SHORT research candidate without changing Production trading decisions.

M05 condition:

```
completed signal-H1 PENGU 72h return <= -0.50%
```

Current Production SHORT candidate generation already uses the completed-H1 feature `features.penguReturn72h` inside `evaluatePenguDualLsV2ShortSignals`. Current Production threshold remains `regimeReturn72hMaximum: 0`.

## Exact observation point

Observe M05 **inside SHORT candidate generation**, on the same completed H1 row that otherwise satisfies the current SHORT candidate eligibility calculation, immediately before the current code sets `signals[index] = true`.

Do not evaluate M05 later in:
- portfolio admission,
- gross allocation,
- shared-risk admission,
- pending-exposure admission,
- order submission,
- runner entry-window checks.

A verified negative-control replay proved that a late portfolio-stage -0.50% veto is not equivalent: it rejected 4 PENGU entries and reduced 10 bps final equity to JPY 3,561,659,479.62405.

## Shadow calculation

For each current SHORT candidate that passes the existing Production signal logic:

```
threshold = -0.005
m05Pass = features.penguReturn72h <= threshold + 1e-12
m05WouldBlock = !m05Pass
```

This value is observation only. It MUST NOT alter:
- `signals[index]`,
- `decision.active`,
- `decision.side`,
- `targetGross`,
- route quarantine,
- DD17/H72,
- cooldown,
- entry timing,
- exits,
- protective orders,
- ownership,
- shared-risk state,
- pending exposure,
- order idempotency.

## Required telemetry fields

For an otherwise-valid current SHORT candidate record:

- `strategyId=PENGU_DUAL_LS_V2_FINAL`
- `route=SHORT_V20`
- `referenceTs`
- `entryTs`
- `penguReturn72h`
- `m05Threshold=-0.005`
- `m05Pass`
- `m05WouldBlock`
- current candidate/decision result
- current rejection reason if downstream portfolio/risk logic blocks it
- eventual realized outcome when the current Production path actually trades it
- exit reason
- realized return / PnL
- source runtime SHA

Forward analysis must distinguish:
1. M05 decision-difference candidate actually traded by current Production.
2. M05 decision-difference candidate later blocked by another independent Production gate.
3. Non-difference candidate where M05 and current agree.

## Historical anchor

Exact formal candidate-root parity:
- baseline candidates: 2,484
- M05 candidates: 2,483
- PENGU SHORT: 44 -> 43
- added candidates: 0
- shared candidate semantic mismatches: 0

Only removed formal candidate:
- signal: 2026-07-17 19:00Z
- completed-H1 72h return: -0.407539%
- route: SHORT_V20
- baseline result: SHORT_HARD_STOP

Exact 10 bps integrated:
- baseline: JPY 4,067,358,397.424793 / PF 2.960180377096512 / DD -12.96457052048714%
- M05: JPY 4,462,295,320.211713 / PF 3.3750309623596784 / DD -12.96457052048714%

## Promotion rule

Do **not** promote M05 from shadow evidence solely because the formal-period result is positive. The formal benefit is currently driven by one decision-changing event, while retained independent windows contain no M05 decision-changing event.

Any future Production proposal must:
1. use the candidate-generation observation point above,
2. preserve all other PENGU logic and sizing,
3. regenerate the exact candidate root,
4. prove semantic parity except for candidates intentionally blocked by M05,
5. rerun the integrated 8/10/20/30 bps portfolio,
6. include forward decision-difference evidence,
7. separately test whether M05 reduces losses without deleting enough winners to hurt compounded portfolio equity,
8. pass ownership/accounting parity.

Until then, Production PENGU logic stays unchanged.
