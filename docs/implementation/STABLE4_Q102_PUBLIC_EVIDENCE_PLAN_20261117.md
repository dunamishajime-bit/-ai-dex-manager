# STABLE4 Q102 public evidence request plan — offline checkpoint (2026-11-17 JST)

## Status

**REVIEW_ONLY_PUBLIC_GET_PLAN_PREPARED**. Non-live private input inspection and request planning only. The result does **not** certify native source/parser trust, old/new writer exclusion, venue protection, bootstrap transaction, approval, or LIVE readiness.

The private request plan was generated on the Owner PC at `C:\tmp\stable4-q102-offline-bootstrap-20261116\public-bootstrap-requests-plan-20261117.json` and must **not** be pushed or copied to a public artifact. Its SHA256 is:

`5f00d58f092c279098984de273d8a19c107ac812d68b9afa2b650f3476486728`

The original rolling H1 cache SHA256 is `969626361eb892d281aec39b25d5374b5966ae23e28ddb646225181195b431d0`.

## Work done

- Added `scripts/ops/stable4_q102_public_request_plan.py`: a **local, no-network, no-order** planner that verifies the observation summary against the exact rolling H1 source SHA256, rejects nonfinite/duplicate JSON and contradictory time/frontier/row counts, and independently inspects archived 5-minute source data.
- The algorithm includes only a continuously covered archive prefix; if a hole exists, it plans the public data request from the **first missing candle**, not after the end of the archive. It rejects duplicate/out-of-order archive timestamps rather than silently guessing.
- A private plan was constructed for **7 symbols** (APT/AVAX/DOGE/FET/FIL/NEAR/ONDO), representing **52 pending continuation outcomes**, with source hashes and archive coverage observations.
- Existing local 5-minute bars suffice through the required horizon for DOGE and NEAR. For APT, AVAX and FET, public supplemental data is needed after the private archive's usable end. FIL and ONDO request only public funding evidence (no M5 request).
- Added `scripts/ops/test_stable4_q102_public_request_plan.py` with **9 synthetic tests** (contiguous coverage, first gap, full coverage, duplicated rows, missing archive, non-M5, source hash/count mismatch, invalid JSON, malformed/future requests).
- The owner-side public collector `scripts/stable4-q102-capture-bootstrap-public.mjs` is explicitly **VPS-only** with a pinned/root-owned SDK release and shared public rate-budget path. No attempt was made to bypass those requirements by using a local or unpinned SDK. It has not been run.
- No private venue fills, account state, order history, raw market candles, H1 snapshot, request plan or evidence JSON have been transmitted to GitHub.

## Next gated steps (Codex or separately verified owner-side execution)

1. Review exact 7-item request plan and source hashes from Owner PC; validate the public GET-only collector's rate-budget, SDK pin, source SHA and output directory. No live unit/STOP mutation.
2. When those prerequisites are satisfied, perform strictly public **GET-only** funding/M5 capture using the existing approved SDK and shared API budget, producing `<symbol>.json` files and independent SHA256 receipts. Never send POST, DELETE, private account requests or live orders.
3. Re-run `scripts/stable4-q102-bootstrap-outcomes.ts` against a **copy** of the observational state, the exact rolling data and request plan; verify 52 matured outcomes, any explicitly unresolved labels, temporal causality, and exact signed hashes of each input. Do not overwrite the original offline state or production state.
4. Separately certify immutable native parser and old/new writer exclusion, include fault-injection and rollback tests, then secure exact Owner activation approval if the wider DD/risk/source gates pass. Keep existing `DRAFT_BLOCKED` guards until then.

At this checkpoint, **Q102 C03 remains BLOCKED**; preparing a public request plan is not completing bootstrap or certifying LIVE economics. No VPS, trading system, STOP, position, owner approval, Kill Switch or runner was changed.
