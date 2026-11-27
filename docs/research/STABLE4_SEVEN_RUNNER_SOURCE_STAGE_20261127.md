# STABLE4 / seven-runner staged source candidate
2026-11-27 — source-only, no trading authorization

This Draft branch carries R21 and P91 public-market observation, strict source SHA/UTC snapshots, optional observation readers in V4/PENGU, IDLE R26 gate exercised **only in SHADOW/PAPER**, a bounded public API retry layer, V4 gross admission source corrections, and read-only candidate/DD/exit verification utilities.

## Verified locally
- R21 archived 378/378 raw candidate regeneration after historical exit-coverage restriction; public market transport 42/42 latest API reads.
- PENGU 41/41 native signal+scoring and 4/4 accepted observational sources.
- IDLE actual ASTER H1 849/849 raw candidates and 197/197 R26 research decisions, **but** dynamic TAO lookback validates 146 retained and fail-closes for 51 historically retained candidates with unavailable prelisting TAO history.
- FET 11/11 entries; exit price and reason match 11/11. Original STOP audit logs close time five minutes after M5 start; no proof of actual exchange fill time.
- All-runner read API retry suites, shared rate budget deferral, no order mutation retry.
- DD gate tests: seven-runner cumulative contribution, 30% maximum, snapshot freshness; no cryptographically proven live account MTM input or production admission authorization.
- R21 isolated STOP8/TP8 H24/H48 and one-slot dry-run logic, no signed fill/reduce-only order path.

## Explicit blockers to production
1. Research observation is **not** executable R21/P91 candidate conversion. R21 has no signed and durable slot/order identity lineage or live certified STOP8/TP8 placement.
2. IDLE R26 is not authorized for LIVE and would require proper certificate and gap handling for TAO historical windows. Existing live exits are unchanged.
3. Cumulative-DD signed account MTM feed and all seven real entry gates are not connected to authoritative, root-issuer attested evidence; dry-run cannot grant orders.
4. R26 full one-year 7-runner backtest from frozen research source is not an exact SHA/live-native reconstruction; V52 pricing is proxy and full rerun may be too slow. A separate frozen-signal artificial stress is not independent trigger-generated BT.
5. Source branch must pass CI, formal full-year parity, synthetic market full-trigger replay, root-issued exact-SHA certificates and Owner authorization before any live promotion.
6. This workflow never writes a credential, mutates a venue, approves, deploys or issues any certificate.

Owner protections: preserve GLOBAL HOLD and any existing venue resident STOPs. No bypass, no dual V12/V96 activation.


## Incremental review: account-wide DD30 (not live)
The original seven-runner per-sleeve DD contribution index is not account-wide peak-to-trough equity drawdown. A separate time-weighted account equity DD module now tracks net deposits/withdrawals, historical peaks and permanent maximum breach, and blocks *new* dry-run entries at >30%. It never authorizes venue orders or suspends exits. Missing/old marks fail closed. Data proof type is explicitly **OFFLINE_RECONCILED_MTM_ONLY**, not a root-signed live account mark. Actual reconciled signed live feed remains a separate blocker.


## R26 LIVE adoption boundary
Optional DISDEX_IDLE_R26_LIVE_CERTIFIED=1 does not itself permit orders. The new R26 admission filter is inspected only after existing protection checks. The R26 root-owned, exact-source-SHA admission certificate is mandatory when explicitly enabling the R26 policy in LIVE. Default false preserves existing certified legacy LIVE policy. There is no R26 certificate issued: missing full seven-runner native-source synthetic rerun, authoritative account-MTM DDR, source-parity coverage and Owner approval. A plain JSON object is insufficient unless root owns the regular file and all independent issuer fields are proven by external governance.


## Multi-SHA seven-sleeve decision ordering — offline only
The standalone research coordinator reads per-runner source SHA pins, checks H1 decision clocks including PENGU M5 confirmation, rejects incomplete native sources/unknown owners/reconciled R21 slot uncertainty, and reserves an in-memory PENDING position on each accepted dry decision so same-timestamp proposals cannot double count capacity. Frozen historical ranking V52 > PENGU > V4 (R21) > Q102 > FET > HYPE > IDLE. No venue orders, asset transfers, or signing are exposed. This test verifies priority and Gross competition, not live multi-process atomic reservation. A production authority-compatible 7-sleeve order state machine remains blocked.


## Re-executed research and stress methodology (27 Nov 2026)
The archived source R26 "R21_ONE" 7-runner account replay was rerun for 10bps/30bps and its summary matched the saved reference exactly: 10bps 1082 fills, max DD 22.21%, win 61.92%; 30bps 1080 fills, max DD 23.09%, win 58.52%. The source still relies on historical native entry-intent tapes and V52 price proxy, so it is **not** pinned current-source complete.

Synthetic: 6 regimes x 4 seeds, 72d each, dynamically regenerated R21 prices/order flows, independent source entries, source STOP8/TP8/24-48h exit, 1 slot and candidate-time DD30 latch: at 10bps worst DD 31.36%; at 30bps worst DD 31.04%. Two/23 DD30 new-entry blocks by fee case. Due to surviving positions and 5m price moves, DD30 does not guarantee <=30% actual DD. The other six native runners were **not regenerated** from synthetic price; prior fixed-signal 98.89% pseudo-stress should be excluded from adoption evidence.

Research evidence is separately preserved in docs/research/y06-r3/STABLE4_R26_REEXEC_AND_R21_NATIVE_SYNTH_DD30_V2_20261127.json on the #674 draft research branch. It provides both reproducible Python sources and SHA-256 output fingerprints.

The independent entry-risk gate is an orderless research component. It cannot control real existing stops, authorize order sends, issue root proofs, or assert full native 7-runner simulation. Formal current-source/pinned-SHA CI remains blocked and is not bypassed.
