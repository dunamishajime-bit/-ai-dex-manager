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


## Three-source synthetic replay
R21/IDLE R26/FET entry functions and native protection/trail contracts were applied to 12 shared artificial markets, 10/30bps, with and without projected STOP loss + 2% price gap reserve. At 30bps, 442 trades with reserve, worst DD 27.98% (without 31.95%); mean terminal JPY8967.72 and 185 wins, below profitability/win-rate goals. This is not full seven-runner coverage or live parity: missing other four sleeves, legacy V4 routes, exact preemption/residual allocation, funding, executable depth, venue rounding and verified owner/STOP lifecycle. Conservative no-preempt rule suppresses candidate entries. See accompanying JSON and TS source. The synthetic generator is not calibrated to market returns, so this result cannot establish live DD guarantees.
The historical formal integrated gate detects exactly four intentionally modified manifest-bound files; base master matches all four old digests. Preserve old manifest; use the candidate pin-delta research record for review. No production installation, formal certificate, or Owner authorization claimed.


## Q102 CAUSAL_V4 / HYPE TREND native synthetic (280d)
Eight paired 280-day mathematical H1 markets were regenerated with 180-day Q102 monthly source training and 336 H1 warmup, 8 causal checkpoints per path (64 Q102 evaluations), and the production CAUSAL_V4 entry instead of legacy V1. Source Q102 V1 would request 3x high-vol (invalid proxy for current V4). Production V4 side-specific HIGH_VOL gross: LONG 1x, SHORT 0.6x. Observed 4 Q102 HIGH_VOL source entries, max modeled DD 9.18% (insufficient sample to validate DD). Legacy HYPE TREND replay native H1 source produced 378 trades, worst synthetic DD 28.10% and some ending below the 10k starting equity. HYPE runner explicitly uses ATR trailingDistance as FIXED protective take-profit on entry, not an active trailing-stop. These are **separate sleeve** tests, not a common wallet or genuine all-seven replay. Q102 S34 fixed exit remains a quote-approximated proxy, no exact H1 order certification. Funded fees, partial fills, market depth, clock jitter and venue-resident protective orders were NOT replayed. See scripts/stable4-q102-hype-monthly-native-v4-synthetic.ts and evidence JSON.


## Proposed source integrity (NOT a replacement authorization)
The old production manifest remains immutable. A newly generated *review-only* manifest records the exact SHA256 digests of all 23 old-manifest source files in this draft checkout, and explicitly identifies precisely four source digests different from the historical approved manifest. It can pass source integrity checks without asserting signed runtime equivalence, exchange protection, Owner approval, or formal release credentials. The candidate manifest labels all these controls UNISSUED / false. Official pinned historical source gate is expected to remain FAIL until the actual exact-SHA formal review process issues an appropriate new release proof. See tests/stable4-proposed-source-integrity.test.ts.


## V52 source safety regression, not synthetic stock BT
Nine local no-venue V52 Python test modules (29 tests) passed on the isolated offline source at review time, covering equity session/halt boundaries, actual heartbeat atomicity, peer order preservation, sticky daily-loss latch, transient reference failure isolation, stock quote staleness, Q102 independent pin, and source integrity Fail Closed. Their SHA256 and console endings are recorded in STABLE4_V52_OFFLINE_RUNNER_SAFETY_REGRESSION_20261127.json. CI replays them as offline-only tests. This does NOT establish native V52 V11/V50 synthetic stock bar/session entry and exit parity or a production certificate.


## HYPE real ASTER source annual candidate/model parity
All 78 archived 2025-10-01–2026-10-01 HYPE TREND candidates regenerated from archived **actual ASTER H1**, matching entry clock, next-H1 open proxy, ATR, STOP and fixed target distances 78/78. Independently regenerated 78/78 STOP (57) and TP (21) modeled exits from 107,136 archived ASTER M5 bars with STOP-first touch and adverse gap-on-open. Exit event timestamps use the **confirmed 5m bar close** (bar.openTs + 300000), correcting a false initial 78/78 clock discrepancy; there are no source-reason/price/clock mismatches after correction. This validates the pinned historical candidate *model*, not actual signed fills, Funding, orderbook execution, protection registration, one-slot account admission, or current root certificate. Reproducible source and data SHA256 in STABLE4_HYPE_AST_H1_M5_78_SOURCE_PARITY_20261127.json. No live changes.


## FET actual ASTER M5 native model replay
All 11 archived FET BRK48 entry times and opens from 2025-10-01..2026-10-01 exclusive were independently evaluated against 76,110 archived actual ASTER FET M5 bars with FET_BRK48_RESIDUAL exact 5% hard STOP, close-activated +5% profit floor -> +3% STOP, +8% arm -> 4 percentage-point trail giveback and 24h TIME. Confirmed five-minute STOP clock (bar.openTs + 300000) rather than bar start resolves the prior seven STOP timestamp differences; all 11/11 prices/reasons/clocks match the archived M5 model (7 STOP, 4 TIME). Reusable, NO-ORDER modeled exit in lib/stable4-fet-offline-m5-exit.ts and source tests 5/5 PASS. No signed orders, funding, portfolio slot proof, live-owner proof or Root certificate.


## R26 certificate authenticity hardening (2026-11-27)
Previously a root-owned unsigned JSON claim with arbitrary 64-digit evidence digest could pass the R26 field checks. The **v2** certificate format now requires a real Ed25519 signature over a canonical, domain-separated message binding exact source SHA, evidence digest, independent approvals, signing date and expiration. At entry time the verifier securely reads the regular root-owned certificate and a separately root-owned preprovisioned Ed25519 issuer public key at `/etc/disdex/attestation/idle-r26-issuer-ed25519.pem`, rejects symlinks, group/world writable files, stale/future signatures and non-Linux hosts. There is NO key, signed certificate or Owner authorization in this branch. Installing/rotating a trusted issuer public key, verifying the external evidence referenced by the issuer and proof of Owner authorization remain privileged formal tasks. No test certificate or ephemeral key is ever a live authorization.
