# V12 V4 full LIVE activation after operator approval — technical gate audit (2026-10-12)

**STATUS: OPERATOR_APPROVED / BLOCKED_REAL_VENUE_LIFECYCLE_CERTIFICATION_AND_RELEASE_COHERENCE.**

This is a **full-LIVE preflight finding**, not a full LIVE activation. The user explicitly approved progressing to full LIVE on 2026-10-12. No one-entry Canary cap was removed and no full-production order authority has been granted. Do not declare success or install invented proof digests.

## Live evidence at 13:06–13:09 JST, 2026-10-12

- Exact V4 Canary: `e8bdd2f522612179b148147d4f76951b2e30f9d7`, active PID 838362, NRestarts=0, mode `CANARY`, last reason `NO_NATIVE_ENTRY_CANDIDATES`.
- Its durable state: revision 357, **zero V4 owned intents/protective STOPs/legs**; all journal event types `ACCOUNT_MARK`. Historical signed Aster GET-only order audit 273 orders / 70 days / `v4TaggedCount=0`, no trade mutations by audit.
- Signed Aster GET-only: **FETUSDT LONG 298**, one `SELL STOP_MARKET` reduceOnly STOP for **298**, no other open positions/orders, USDT wallet ~72.351. Do not touch FET.
- Other PENGU / Q102 / V52 / FET / HYPE / Idle / risk / Margin Guard runners remain on Production `ce1edeead8d0f9e5d88e829d415057117502a335`. Shared daily risk tripped=false, Margin Guard HEALTHY, Kill Switch inactive, shared pending exposure empty.
- Old V12 and old V4 masked, new V4 Canary active, current Production symlink unchanged.
- The existing one-entry venue-minimum Canary permit is exact-SHA, max **25 USDT**, expires **2026-10-13 00:49 JST**. Do not extend or renew it automatically under the full-LIVE approval.
- Existing initial postcutover evidence at 12:58 JST: 9 completed V4 cycles, 2 real FET lock contentions **resolved**, zero unresolved. This does not prove long-run reduction; FET account lock remains unchanged.

## Non-negotiable technical gates

1. **Independent, authentic venue lifecycle missing**. File `/etc/disdex/v12-v4-production-certification.json` **MISSING**. The deployed certified gate `lib/v12-v4-certified-gates.ts` requires a root-owned exact-release v2 certificate with 41 verified routes, separately grounded SHA256 proofs for native source and exit, portfolio risk, trade execution, same-symbol protection, independent forward, and real Aster lifecycle: signed orders, signed positions, partial-fill/restart protection, same-symbol STOP/exit races. Its venue mode must be `ASTER_TESTNET`, `AUTHENTIC_PRODUCTION_HISTORY` or `CONTROLLED_PRODUCTION_CANARY` with `realVenueObserved=true` and `simulatedOnly=false`. No V4-specific venue fills currently exist. Mock and 149 passing tests do **not** establish real venue lifecycle.
2. **Full-production runtime configuration missing**. Files `/etc/disdex/current-runtime/e8bdd2f522612179b148147d4f76951b2e30f9d7.env` and `/etc/disdex/disdex-v12-v4.env` are **MISSING**. The template `disdex-v12-v4@.service` also references new-SHA-bound shared-risk and Margin Guard units which are not the existing active Production units. Do not start this incomplete template.
3. **Peer lineage in full certified mode differs from Canary**. In `scripts/v12-v4-production-runner.ts`, CANARY sets `peerLineageMode=ATTEST_EACH_PEER`; ordinary CERTIFIED uses `UNIFIED_RELEASE`. Existing PENGU/Q102/V52/FET/HYPE/Idle and Risk/Margin remain on `ce1edeea...`, so simply switching V4 to CERTIFIED at SHA `e8bdd2f...` without a separately certified coherent multi-release solution cannot be assumed to pass signed peer attestation or shared risk. Do not disable peer checks or rewrite peer identities.
4. **Source/forward evidence and risk adoption**. Historical reproducibility evidence covers 41 routes but the prior certification dossier reports out-of-period V2 PF ~0.57 and Y06 PF ~0.30. These are not future profitability guarantees; user approval to attempt full LIVE does not transmute independent evidence into PASS. The certificate also requires explicit `forwardUnderperformanceAcknowledged` and approved gross exactly V12 3.0, crypto 3.5, total 4.75, recovery 2.5.
5. **Separate root operator activation**. New full production `current.json` root authorization is distinct from `v12-v4-canary.json`, and cannot be copied merely because the Canary was authorized. Make this final after validated non-fabricated certification.

## Safe execution path to completion

- Retain existing active Canary and protected FET position/STOP without changes.
- Gather and independently verify authentic Aster lifecycle for the *actual implementation* (natural V4 canary fill when its causal conditions occur, or authentic existing Aster production order/trade/STOP/restart/same-symbol evidence proven applicable). Never place artificial test trades or fabricate hashes.
- Require independent 41-route source, exit, cross-sleeve Gross and forward certification, including explicit reporting of negative out-of-period PF. Run a full signed-venue lifecycle and restart/unknown-result/partial-fill/race evidence check.
- Implement/validate exact multi-release peer attestation for CERTIFIED if it is safe, or deploy a coherent release with signed and owner-safe cross-Runner handoff; do not mass restart active FET or other Runners or unlink existing STOPs.
- Stage genuine production env, current/previous/rollback, watchdog and shared rate-budget/Gross locks without active mutations until all gates pass.
- Only after independently verified proofs may an authorized root operator install the bounded exact-SHA v2 Production certificate and distinct operator activation artifact; run full preflight and signed account readback, then perform single-owner V4 cutover, followed by independent verification.
- Never claim full LIVE complete while certificate or venue proofs are missing.

**Current operational decision: KEEP_ONE_ENTRY_CANARY; FULL_LIVE_NOT_YET_CERTIFIED.**
