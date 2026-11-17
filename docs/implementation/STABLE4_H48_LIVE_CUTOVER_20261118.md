# STABLE4 H48 Production LIVE cutover evidence

実施日: 2026-11-18 (JST)  
Deployment target: `professional-dismanager.net`  
Candidate release SHA: `e0e4f1d8f22b62e9410188ef6e590a20e31f760f`

## Authorization and release binding

- Owner approval: `9ae68788-91df-44ac-b616-beb076cf65ff`
- Operation: `HYPE_STABLE4_H48_TIME_ONLY_LIVE`
- Scope: `HYPE_TREND_LONG`
- Policy: `H48_TIME_ONLY`
- Plan SHA256: `82d9eb3f4ff4c9787f59c1843a69249e66df6d95696e426b4ee984719ad152ce`
- H48 workflow run: `44067833780` (certificate issue and GLOBAL HOLD re-arm succeeded)
- Root cutover job: `3e91304eb8cd488da1c8886b478592b2`
- Immutable release marker: root-owned mode `0444`, contents equal the candidate SHA.
- H48 certificate SHA256: `ffcd71bb1d296118fb3538bc03fae536f06050932ffd2fcecdfd6fd70fa2a623`

## Runtime result

The official Root cutover job completed with `Result=success` and the H48 receipt:

`/var/lib/disdex/unified-deploy/receipts/hype-protected-hold-e0e4f1d8f22b62e9410188ef6e590a20e31f760f.json`

Receipt status is `HYPE_PROTECTED_HOLD_VERIFIED_NOT_ORDER_ENABLED`. It binds the
candidate SHA, scope and plan SHA, records `runtimeLive=true`,
`oldServiceEnabled=false`, `ordersSent=0`, `cancelsSent=0`,
`positionChangesSent=0`, `protectedHoldPreserved=true`, and
`authorizesKillClearance=false`.

Three real decision-cycle ticks were observed:

`1794928960904`, `1794929864144`, `1794930764450`

The live tick file reports the same candidate SHA, PID `4154950`, the immutable
candidate working directory, and `newOrdersAllowed=false` while the global
protected HOLD is active. The final tick was held by the existing shared rate
budget guard (`ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT`); no mutation was sent.

## Safety and reconciliation checks

- Candidate unit `disdex-hype-long@e0e4f1d8f22b62e9410188ef6e590a20e31f760f.service`: `active/running`, PID `4154950`.
- Previous HYPE unit `disdex-hype-long@a7eee1f91d86d51f2333da117243d044ae1332dc.service`: `inactive/dead`, `masked`.
- Root pin manifest HYPE entry points to the candidate SHA and H48 authority binding.
- GLOBAL Kill Switch remains `active:true`, `action:HOLD_PROTECTED`, `scope:GLOBAL`; it was not cleared or edited.
- Signed Aster GET-only diagnostic: `ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS`; positions `[]`, open orders `[]`, and all mutation counters `0`.
- Pending exposure registry: active entries `0`.
- Shared crypto daily risk: maximum loss `7.5%`, current loss `0%`, `tripped:false`, `sourceComplete:true`.
- Margin Guard: `HEALTHY`, `ordersAllowed:true`, active managed positions `0`, `ordersSent:false`, `positionChangesSent:false`.
- Q102 Writer remains a single active systemd unit (`disdex-quality102-causal-v1@ef1ab178e26a7bf5bddb6473467765edba242e1d.service`); its child processes share that one cgroup.
- Public HP `/realtime` returned HTTP 200. Authenticated runner APIs require the existing HP login session and were not mutated.

No test order, cancel, forced close, Kill Switch clear, or protection edit was
performed during this cutover.

## Deferred work

The DD20% research/re-design, DD recovery-rule review, strategy win-rate work,
and additional BT/HP development remain deferred per Owner direction. The
existing Shared Risk, Gross, Kill Switch, account-lock/rate-budget controls and
protective STOP pathways remain in force.
