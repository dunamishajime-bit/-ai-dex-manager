# V12 V4 — non-circular progressive LIVE certification and promotion plan (2026-10-12)

**Status: engineering plan; NO new trade authority.**
Owner approved progression to full LIVE. The old requirement to observe every V4 live execution edge-case *before allowing V4 to take any relevant order* creates an indefinite circular dependency. Replace it with a **feature-scoped, fail-closed certification architecture**, not a fabricated global PASS.

## Evidence separation and verification

**Layer 1 — decision parity (offline, must PASS before every applicable live route):**
- Verify all 41 frozen route names, causal closed H1/H2 inputs, priority, risk sizing, same timestamp logic, actual 10bps/20bps DD and out-of-sample performance on independent datasets.
- Past accepted-trade replay is evidence of those examples only; it does not prove there are no extra live candidates.
- Reject or keep shadow any route with unmet independent parity. Do not claim original 291.33m JPY BT result if operational constraints make a materially different strategy.

**Layer 2 — shared Aster API semantics (authentic venue readback + deterministic V4 order-cycle tests):**
- Obtain timestamped **signed GET-only** order, position, trade and STOP records from Aster production history (FET and other strategy orders can prove generic Aster API semantics, NOT V4 end-to-end execution).
- Cross-check average fill price, partial fills when observed, reduceOnly resident STOP status/quantity, exchanges' idempotent client IDs and canceled/terminal order semantics.
- Pair those actual API payloads with V4 dispatcher, journal, partial-fill STOP rearm, duplicate-avoidance, restart-recovery fault-injection tests. A failure is an execution blocker; a mock PASS must never be labeled a venue PASS.

**Layer 3 — V4's unique live lifecycle (bounded genuine natural-signal Canary):**
- Preserve live signed reconciliation of each V4 order and protective STOP, expiry-independent reduce-only exits, and strict order ownership.
- For the first genuine V4 entry, keep a non-renewable bounded permit and capture the full chronological order/fill/STOP/cancel/restart evidence. Do not create fake strategy candidates or artificial main-account test orders.
- The existing Canary is bound to `e8bdd2f522612179b148147d4f76951b2e30f9d7`, one entry, <=25 USDT, expires 2026-10-13 00:49 JST; **no automatic renewal or size escalation**.
- If no natural entry occurs, it proves no V4-specific fill data yet; it does not invalidate a separately proven generic exchange connector. Preserve the distinction.

## Feature-gated promotion instead of one impossible all-or-nothing certificate

Create a new independently reviewed, root-owned, exact-SHA, bounded **restricted LIVE** authorization *only after real Layer 2 evidence and test acceptance*:
- Potentially permit validated ordinary single-leg lifecycle in a limited V4 gross budget, and require live pre-entry risk check/STOP readback. Limit concurrent owned legs, forbid a second V4 leg on the same symbol, and disallow unproven simultaneous cancel/exit/partial-STOP race paths. A protective action already necessary for a signed position remains allowed after authorization expiry.
- Unsupported race modes must be rejected *before entering a state the system cannot safely exit*. Never disable STOPs or sell existing protected FET positions to simplify the test.
- Full strategy with historic same-symbol overlap requires separate evidence; original research had 261 overlapping same-symbol V12 leg pairs. A single-leg restriction changes strategy capacity and invalidates any claim that original BT performance is unchanged.
- Graduate features *individually* when their authentic execution and recovery evidence meets an explicit criterion, under monitoring and exact-SHA operator approval.
- Keep abnormal unknown-result and broker position divergence as hard fail-closed conditions. No forced lock release, no shared Gross/Margin Guard/Kill Switch bypass, no retroactive journal forgery.

## Existing definite engineering closure

Candidate branch `fix/v4-full-live-certified-peer-attestation-20261012`:
- Fixed mixed-release peer attestation: both CANARY and CERTIFIED call `liveV4PeerLineageMode` to select `ATTEST_EACH_PEER`. This still enforces real active systemd unit, PID, exact per-peer SHA, durable source and freshness.
- Isolated VPS worktree `/home/deploy/disdex-trading/work/v4-full-live-peer-cert-20261012`.
- Candidate code commit **`95d3dd57748d4094184fb5af853c81561bfb715e`** passed **150/150** V4-related tests across 46 files and TypeScript `tsc --noEmit` in the isolated environment. Current active Canary remains old SHA; **do not claim this code deployed**.

## Remaining engineering work, in order

1. Generate auditable signed GET-only user-trades/order/position evidence with pagination and hashes, redacting identifiers and secrets, using appropriate shared rate-budget.
2. Implement and validate a **new per-feature policy contract** for ordinary restricted LIVE versus fully enabled multi-leg LIVE. Do not overwrite the existing production v2 certificate with missing-hash placeholder values.
3. Validate single-leg entry, partial fill, protective STOP readback, unknown ACK, crash/restart, time exit and concurrent FET/Idle locks against the exact V4 adapter using real shapes. Keep peer systemd and signed venue ownership attested.
4. Perform route-by-route independent parity and capacity-aware BT for the specific restricted deployment. Disclose observed external-period PF ~0.57 and Y06 PF ~0.30, and the agreed DD ceiling 21%; do not assert prospective profitability.
5. Once the restricted contract passes, obtain explicit SHA- and tier-bound root authority, build immutable rollback and activate with fresh signed venue state. Only promote unproven edge-paths after actual evidence, with no silent auto-promotion.

**Decision today:** Canary remains running; full LIVE is not yet proven. The circular **method** is replaced by feasible incremental certifications, but the necessary authenticated evidence and new tiered implementation are not yet finished.
