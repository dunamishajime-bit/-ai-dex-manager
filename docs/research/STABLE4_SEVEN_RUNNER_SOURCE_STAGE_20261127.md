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
