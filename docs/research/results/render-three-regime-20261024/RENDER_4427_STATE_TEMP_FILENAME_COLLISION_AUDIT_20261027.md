# RENDER #4427 — same-PID/same-millisecond state temp-name collision audit (2026-10-27)

**STATUS: RESEARCH_ONLY / NEED_NATIVE_ALLOCATOR / order_authorized=false.**

## Newly demonstrated boundary

The original TypeScript `writeIdleState()` creates its temporary pathname as
`${path}.${process.pid}.${Date.now()}.tmp`. There is no per-call nonce or exclusive temp-file creation.
Two concurrent saves in one Node process and the same millisecond can therefore target **the same temporary file**.

Using the actual Windows filesystem, a controlled interleaving of the original TS method showed:
1. Writer A writes its temporary state, then writer B overwrites the same temporary pathname.
2. A renames the shared temp path to the final state path and returns **success**, although the persisted state belongs to B.
3. B's subsequent rename fails with **ENOENT**, although B's state was persisted by A's rename.
4. The result also reproduces with reversed A/B writer order. Same-millisecond **serial** saves and different-millisecond **serial** saves both complete successfully.

This is a **temp-file identity / acknowledgement mismatch** distinct from the already reported cross-process last-writer-wins CAS boundary and post-rename chmod acknowledgement failure. It may matter if same-process saves overlap; this audit **does not prove** that the real Runner naturally issues such concurrent saves.

## Reproducibility

- Original source pinned to commit: `939b59da49ce7960485a2004b0068dc63417ae82`.
- `lib/idle-priority-short-state.ts` raw SHA256: `4f09cb0c7f430ffde65c993b7ac57af8284605eefa89df2d11973bb77ec09f07`.
- `config/idlePriorityShortPolicy.ts` raw SHA256: `6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8`.
- Audit Python script raw SHA256: `abbb55241ff9f272d1cbef0cc97aab92aa53f36d3e476a7fda4f78f94fecb46f`.
- Two independent Python launchers in each of normal / `-O` / `-OO`, with six cases per launcher: **36/36 PASS**, six child processes exit 0.
- Canonical result JSON SHA256 (per launcher): `9988610e859adc2b59f1dba93d3f49bd905612041c474b208cf170595aac2f2e`.
- Evidence JSON raw SHA256: `146b8eea6bf1848dca2d219432a783084818232bce4cee85cf1cdf09362c2727`.
- Original TypeScript executed through Node `stripTypeScriptTypes` + VM with real Windows `fs/promises` calls and deterministic test-only scheduling.
- All test files, temporary paths and evidence generated inside `C:/Users/dis/render4427-research-only/`. `C:/tmp` not accessed.

## Boundaries and next work

The deterministic timing and interleaving were imposed by the audit harness; no natural OS collision rate, real Runner concurrency, Production incident, Native8 integration, or venue event has been established. The original state-save code was not modified. Investigate actual state-writer call graph and whether same-process overlap is possible before treating this as an operational defect. Continue native allocator, owner/lease identity, pending/venue receipt and GateProof provenance audits. Do not use synthetic evidence as venue certification.

No VPS, LIVE, Production, HP, real order, eight-strategy runtime, legacy IDLE Core overlay block, or existing dirty worktree was changed.
