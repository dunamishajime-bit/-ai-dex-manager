# RENDER #4427 — Pending registry concurrent read/modify/write audit (research only)

## New primary-code finding
Pinned `lib/disdex-pending-exposure-registry.ts` performs `readPendingExposureRegistry()` → in-memory replacement → `atomicWrite()` in both `upsertPendingExposure()` and `releasePendingExposure()`. Each write uses an atomic file rename, but the **whole read/modify/write transaction has no independent interprocess compare-and-swap, version check, or serialization inside this module**.

Executing the **original extracted TypeScript functions** with Node `stripTypeScriptTypes` and a deterministic in-memory read/write barrier showed:

- Sequential A then B upserts: A and B retained, active gross 0.50.
- Concurrent A/B upserts from the same initial snapshot: only one survives (either A or B), active gross 0.25.
- Concurrent release(A) and upsert(B), both reading A as pending: with release committed first, A is resurrected as PENDING and B appears (gross 0.50); with upsert committed first, B disappears and only released A remains (gross 0).

These are **research-only interface-level concurrency counterexamples**. The mock replaces file I/O and does not attest actual process scheduling, real filesystem durability, existing account-lock coverage across all callers, Production code identity, or venue state. It does not establish that LIVE experienced the race.

## Independent PC verification
- Fixed primary source commit: `939b59da49ce7960485a2004b0068dc63417ae82`
- Pinned primary raw SHA256: `09aafb62fe408600452c1fbcbba2158c02b8b99eedaef70c187e4f8677df4100`
- PC-fetched audit script raw SHA256: `1cd988ad6a3f15734b9c1939d11f717b9e6943b9f0face8545152b58c30d6ecf`
- Two separate Python processes in each of normal, `-O`, `-OO`: six exits 0; all canonical JSON SHA256 `e332a19e4b37cbffc635455161d24644ae64fa09d28d2190201b1d354742d0f6`.
- Five deterministic scenarios per run: 30 scenario results total. Source SHA is checked before execution.
- PC working directory was `C:/Users/dis/render4427-research-only/`; no audit-generated PC files or access to `C:/tmp`.

## Scope and safety
No Native8 order authorization, economic BT, Production/VPS/HP change, actual orders, or existing worktree edits. Owner `IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH`, Route `IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT`, Gross 0.25x remain research-only and **NEED_NATIVE_ALLOCATOR / order_authorized=false**.

A fix cannot simply ignore stale pending records or relax Shared Risk. The next investigation must identify whether every pending writer shares an actual cross-process account lock and, separately, whether crash-recovery receipts tie venue open orders, account reservations, pending entries, sequence, as-of, source identity, and Gross to one authenticated snapshot. A serializable journal/transaction or properly versioned compare-and-swap is a possible research design, not an approved production change.

**Evidence limitations:** source is pinned historical code, not proven current Production; synthetic concurrent barrier is not real disk/venue evidence; Native8 owner, independent trust root and 13 GateProof remain unauthenticated. Fail closed; no 10/30bps economic BT.
