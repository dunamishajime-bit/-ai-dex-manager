# STABLE4 pre-LIVE handoff: Q102 D126 and V52 scoped flatten
Status: SOURCE-ONLY / NOT AN ORDER PERMIT / NO LIVE CUTOVER (2026-11-26 JST)

## Owner decisions preserved
- Q102 HIGH_VOL: if completed UTC D, completed UTC 12H, completed UTC 6H close-to-close returns are each strictly positive, replace a pending SHORT candidate with LONG at the same entry timestamp and 0.60x requested gross. Do not promote to ordinary LONG 1.0x. Nonpositive keeps SHORT. Invalid/missing history fails closed for that candidate.
- Other Q102 families, original LONG, one-slot state, exits, V4 entry and concentration rules, PENGU, IDLE, FET, HYPE: unchanged.
- V52 daily strategy loss 3.5%: verified loss trip, not data/API failure, persists V52-only flatten intent before order operations. Block V52 entries, cancel managed pending orders, close only V52 V11/V50 slots in eligible market session with existing reduce-only exits, verify FLAT, then complete intent. Incomplete exits retry across UTC rollover/restart. Other runners and Shared Risk7.5/GLOBAL HOLD remain separately governed.
- Correct legacy V52 ledger time field exitAt and avoid second deduction of its already-included commission.

## Research and source validation
- Q102 D126: 182 archived candidate direction and return matches (169 prior Binance proxy, 13 target ASTER), future-bar invariance and seven synthetic checks. These are direction tests, not actual fills.
- 2025-10-01 to 2026-10-01 full-account research, no V4 concentration, STABLE4 gross and HYPE STOP8 proxies, 10/30bps: Q102 contribution DD16.058%/18.956%; portfolio DD26.759%/21.364%; terminal JPY37224848/11719568. Results are repeatedly target-sampled research, not certified deployment parity; 216 missing M5 H1 fallback hours on 8 original flip candidates. Full independent forward venue-fidelity and cumulative-DD testing pending.
- Run pre-LIVE source CI workflow, full TS typecheck, original V4 Q102 signal test, Python daily strategy latch, scoped flatten persistence/failure and zero-other-runner mocks. Tests must never place real orders.

## Mandatory acceptance before final Codex cutover
1. Freeze reviewed, merged immutable release SHA; source hashes, proven runner process and protected exits. No overlays/reused SHA.
2. Finish H48 STOP8 native service/systemd and distinct protected EXIT path. H48_TIME_ONLY certificate is obsolete for STOP8.
3. Resolve signed Gross Crypto3.0/Stock4.0/Total4.25/HYPE1.5 vs old 3/1.5/3.5/1.0; Shared Risk 7.5 and per-Runner cumulative DD capital/peak semantics. The account-relative attribution index is NOT an executable allocated-capital DD gate.
4. Re-run source-pinned integrated full-year, out-of-sample, synthetic shock 10/30bps on all runners with M5 fills, stops, gaps, PnL/fee/funding and midnight session/partial-order recovery; certify Q102 D126 LONG and V52 daily flatten. Fail closed on unknown position or missing proof.
5. New exact-SHA HP/Owner environment approval, Root H48 STOP8 certificate and protected EXIT, plus seven runner scoped order permits must be issued via normal signed path. No approvals or tokens are created by this PR.
6. Codex final activation is allowed ONLY after above gates pass; otherwise maintain GLOBAL HOLD and report blocked checks, with rollback/preflight evidence.

## Related unfinished work
- H48 native source/root protected coordinator PR #668 Draft.
- Gross and exact preflight PR #664 Draft.
- Order-enable owner/Root gates PR #654 Draft.
- V4 STOP8 source function exists for TIME routes in lib/v12-v4-time-stop-approval.ts; an exact-SHA root-owned operator artifact is still required.
- STABLE4 DD30 PR #596/#597 require SHA and review verification.

All production deployment, order-enable, LIVE orders and GLOBAL HOLD changes remain untouched.
