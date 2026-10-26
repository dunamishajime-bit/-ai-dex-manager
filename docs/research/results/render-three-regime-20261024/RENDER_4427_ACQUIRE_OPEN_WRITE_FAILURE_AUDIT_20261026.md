# RENDER #4427 — exclusive-open then write failure boundary (2026-10-26)

**Research-only. No Production, LIVE, VPS, HP, order, current-eight-logic, dirty-worktree, or legacy IDLE Core changes.**

## New verified finding

The original `FileAccountOrderLock.acquire()` creates its lock path using exclusive `open(path, "wx")` and only then writes its JSON document. When `fd.writeFile()` raises an injected `EIO` after the exclusive open succeeds, the `finally` closes the descriptor but no failure cleanup removes the created path. Both empty and partially written JSON persist in the isolated in-memory filesystem. A subsequent `acquire()` sees `EEXIST`, fails to parse the existing file, and returns `null` instead of acquiring the lock. The behavior is conservatively fail-closed but can block future entries until independently verified reconciliation.

## Primary-code and PC proof

- Fixed primary commit: `939b59da49ce7960485a2004b0068dc63417ae82`.
- Original TypeScript: `lib/disdex-account-order-lock.ts`, raw SHA256 `169f9b9a7091da9467317435a331b97033383158d8d050008e60b2b52d16a10b` independently fetched and hashed on the authorized owner PC.
- Audit script: `scripts/dd-reduction/audit_render4427_acquire_open_write_failure_20261026.py`, PC-fetched raw SHA256 `509304f4d7747167fe91fd2d071d3924c5515050950b8670d1dc96767e2537e3`.
- Original class `acquire()` and its related code were extracted from the fixed TypeScript bytes and executed through Node `stripTypeScriptTypes` in an in-memory virtual filesystem; only the filesystem boundary and constructor TypeScript parameter-property syntax were adapted. No real lock files were opened.
- Two independent Python processes in each of normal, `-O`, and `-OO` modes; eight cases each; **48/48 matching expected outcomes**, all six exit code zero.
- Canonical worker JSON SHA256: `8fa75df697b7bc444464b12166a19b1b98846fd2420d955ab13f62cc3d5caec9`, identical across all six processes.

The positive and negative controls include a normal exclusive acquisition, valid and malformed existing-lock conflicts, an `EACCES` open failure that leaves no file, a vanished path that allows the built-in retry, and a manual-reconciliation **in-memory control**. Neither automated deletion nor a bypass is recommended.

## Evidence limits and decision

This is an injected-failure **memory-FS** result, not proof of a real disk interruption, real OS path behavior, current Production incidence, Native8 preallocation, 13 genuine GateProofs, actual venue reconciliation, or real-order safety. Do not auto-remove the file based on age or JSON parse failure. Require independently proven owner absence, pending/venue reconciliation, identity-safe recovery, and operator trust root. Maintain `NEED_NATIVE_ALLOCATOR` and `order_authorized=false`; no economic BT or LIVE adoption.

## Next checks

Trace actual `acquire()` callers and crash/recovery entrypoints, then verify cross-process ownership and OS path identity without changing any production component. Continue full dynamic import/patch closure, genuine GateProof provenance, Native8 preallocation and owner-priority, and shared-symbol reservation evidence. Never treat the earlier searched period as unused OOS.
