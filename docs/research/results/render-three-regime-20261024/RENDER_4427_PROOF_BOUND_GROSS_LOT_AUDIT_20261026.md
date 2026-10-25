# RENDER #4427 — Proof-bound 0.25x quantity and allocation attestation (2026-10-26)

## New research artifact and independently reproduced result

Implemented **research-only** pure Python `assess_research_allocation()` that binds a single candidate's requested Gross, admission Gross, reservation Gross, pending Gross, normalized lot and maximum entry notional to the same immutable canonical-JSON SHA256 envelope. The verifier checks a 0.25x step-floor against **equity × requestedGross / price**, rather than a hard-coded 1x target. It rejects changed Gross at each stage, lot/notional mismatch, excess rounding loss, insufficient Gross capacity, stale/mixed inventory snapshots, incomplete/duplicate proof entries, wrong owner/route, and unhealthy safety flags. Its **only successful result** is `NEED_NATIVE_ALLOCATOR` with `order_authorized=false`. It cannot place orders.

This is a **new research-only design/test artifact**, not a fix or change to the original IDLE runner, not proof of Native8 parity and not proof that any genuine GateProof is present. The input envelope and independent pin used by tests are synthetic and are NOT an operator trust root.

## Fixed primary code provenance

At fixed source `939b59da49ce7960485a2004b0068dc63417ae82`, owner-PC Python fetched raw primary source bytes and verified SHA256:

- `lib/idle-quantity-feasibility.ts`: `4d87b6456f75077aabb1db2422c960d95386ae6ffbb924b878d40a8eeeef664d`
- `lib/idle-priority-short-runner.ts`: `0a5682f30add54b7f03714c8b40596af80f6b80cd04b360c6009f62f3cb22f33`
- `lib/idle-priority-short-live.ts`: `185e0991cb810bba903dfa299df70f5a1e805fe6d9b76242247e672bcd30889c`
- `config/idlePriorityShortPolicy.ts`: `6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8`

The pinned runner calculates normalized quantity from policy Gross, reserves `admission.gross`, stores `pending.gross` from policy and caps order notional using `admission.gross`. This research adapter treats **all four** as a single proof-bound value. It does not rewire the runner.

## Synthetic independent verification

- Adapter source: `scripts/dd-reduction/render4427_proof_bound_gross_lot_research_20261026.py`, raw SHA256 `13b86ba498d61a00fcdbf6bd55b7ed110f2ab2e4c1fcbd7045d6051f6e5c78d6`.
- Independent audit: `scripts/dd-reduction/audit_render4427_proof_bound_gross_lot_20261026.py`, raw SHA256 `936500d0da4e6e2f36c4a79618473a69cfb1df6b46395cc4225f12dbbf4accad`.
- Owner PC: `C:/Users/dis/render4427-research-only/`; only in-memory execution and read-only GitHub fetches. `C:/tmp` not accessed.
- Each of two independent Python processes under normal, `-O` and `-OO` fetched and verified the primary sources and adapter bytes. Each independently ran **30 deterministic synthetic cases**, all matched expected verdicts; **180/180** total, six exit code 0.
- All six canonical audit JSON digests equal `37bd0120398fca3ff68777914123f1a2606904d03fc2600934fe03a7261905d2`.

The test matrix includes valid 0.25x and step-floor acceptance (research-only), three separate Gross binding mismatches, changed entry cap, reduced Gross without reproof, quantity/notional mismatch, >1% rounding loss, venue min/max limits, stale inventory, mixed proof timestamp/sequence/root, 12/13 proofs, duplicate/missing source, wrong route, same-symbol/pending/cooldown/dedup conflict, unhealthy shared risk/margin/account lock, kill switch, insufficient Gross capacity, and a changed envelope with an unchanged independent SHA pin.

## Hard limitations and next audit

1. The synthetic manifest SHA is supplied by the test; it does **not** establish an independent operator signature or source identity. A fake source name or self-asserted snapshot root must not be treated as genuine evidence.
2. The 5-minute freshness bound is only a research assumption. Monotonic sequence is checked for equality within one synthetic snapshot, **not persisted across snapshots**, and atomic/durable/distributed dedup is not certified.
3. The adapter is **not wired to Native8**, the LIVE runner or the old IDLE Core. No order, Production, VPS, HP or existing strategy changes occurred.
4. Genuine Owner/Route registration, 13 GateProof generation, signed operator trust root, complete dynamic import/patch closure, actual Aster M5 fills/funding, Native8 preallocation/owner priority and cross-process allocation remain unverified.
5. Never convert this research verdict into order permission. Continue Fail Closed for same-symbol, cooldown, Shared Risk, Gross, Margin Guard, Kill Switch, Pending, account lock and dedup. No economic BT until authentic Native8 evidence exists.

**Status: RESEARCH_ONLY / NEED_NATIVE_ALLOCATOR / NO_ORDER_AUTHORIZATION.**
