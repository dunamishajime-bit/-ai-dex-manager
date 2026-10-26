# RENDER #4427 — Cross-language Owner / sleeve contract audit (research only)

Date: 2026-10-26 JST. Scope: isolated, immutable research evidence. **No LIVE, Production, VPS, HP, order, existing strategy, or dirty worktree mutation.**

## New finding

The proposed independent RENDER research Owner `IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH` is **not accepted consistently by the existing TypeScript and Python pending-reservation contracts**:

1. `lib/disdex-pending-exposure-registry.ts` — the pinned original `expectedSleeve()` rejects this exact Owner with `PENDING_EXPOSURE_OWNER_UNKNOWN`. It accepts the pre-existing `IDLE_PRIORITY_SHORT` as `CRYPTO`; that is not equivalent to registering the new Owner.
2. `scripts/disdex_pending_exposure_registry.py` — the pinned original `_expected_sleeve()` classifies any Owner containing `IDLE` as `CRYPTO`, including the proposed new Owner.
3. `scripts/disdex_account_order_lock.py` — the pinned original `AccountOrderLock.reserve()` constructs `sleeve=STOCK` for the new Owner, because its crypto classifier recognizes only `V12`, `PENGU`, `FET`, and `QUALITY102`. The original Python `_validate_entry()` therefore rejects that synthesized reservation with `PENDING_EXPOSURE_OWNER_SLEEVE_MISMATCH`.
4. `lib/disdex-account-order-lock.ts` writes `sleeve: "CRYPTO"` on its reservation path, but the TypeScript registry's Owner allowlist still rejects the new research Owner.

**Implication:** Merely adding a Route or bypassing the TypeScript allowlist would not establish a consistent cross-language Owner registration. Any future proposal requires explicit Owner-to-sleeve contracts in both languages and the reservation writer, independent authority proof, and the real Native8 allocator. This is a **fail-closed compatibility gap**, not evidence of a successful bypass or a LIVE defect.

## Exact source identity

All four source files were downloaded as raw bytes from fixed commit `939b59da49ce7960485a2004b0068dc63417ae82` and compared to SHA256 pins **before** isolated execution:

| File | SHA256 |
| --- | --- |
| `lib/disdex-pending-exposure-registry.ts` | `09aafb62fe408600452c1fbcbba2158c02b8b99eedaef70c187e4f8677df4100` |
| `lib/disdex-account-order-lock.ts` | `169f9b9a7091da9467317435a331b97033383158d8d050008e60b2b52d16a10b` |
| `scripts/disdex_pending_exposure_registry.py` | `0ca274dcbe5fd35b3b6fde7c200c65f70532e360994958cb78141ba626ae5e3d` |
| `scripts/disdex_account_order_lock.py` | `839fff2b49b0b679d13391ee9b1a2ad6fd2df759db9128fbd47eeae6c34bb17e` |

No module-scope Python source was imported. Only pinned Python AST functions and the precise reservation sleeve expression were compiled in an isolated namespace. The original TypeScript `expectedSleeve()` function was extracted from pinned bytes, type-stripped, and executed in an in-memory Node VM. No order-capable source or module-level initialization was executed.

## Synthetic cross-language matrix

| Owner | TS registry | Python registry | Python lock-generated sleeve | Python registry on generated row |
| --- | --- | --- | --- | --- |
| `IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH` | UNKNOWN / reject | CRYPTO | STOCK | reject: sleeve mismatch |
| `IDLE_PRIORITY_SHORT` | CRYPTO | CRYPTO | STOCK | reject: sleeve mismatch |
| `V12_V4` (control) | CRYPTO | CRYPTO | CRYPTO | accept |
| `HYPE_LONG` (additional control) | CRYPTO | CRYPTO | STOCK | reject: sleeve mismatch |
| `V52` (control) | STOCK | STOCK | STOCK | accept |

These rows use **synthetic reservations**. The result is not proof that any specific LIVE runner calls the Python lock with the tested Owner, or that Production is running this exact fixed source. The extra Owner rows are compatibility controls, **not authorization to alter existing strategies**.

## Independent PC verification

The GitHub-hosted audit script was fetched into memory and SHA256-checked on the owner's PC; its raw SHA256 is `f51bf5bb709def4e4906022a538cccaed58bba40c3cccc36cb3b225c4ad5f8df`.

- Normal Python: two independent processes, both exit 0.
- `python -O`: two independent processes, both exit 0.
- `python -OO`: two independent processes, both exit 0.
- Five matrix cases per process: **30 reproduced case rows across six independent Python processes**.
- All six canonical JSON results have SHA256 `c413aaf84ccaddb9babe50007e1ac05a0f8419f2c0f9894b1d53feb3929ccb8b`.
- The source and audit script were read from GitHub over HTTPS; the PC did not write research artifacts or touch `C:/tmp`.

The broader pinned-source inventory scan read 270 `lib/` source files and 1,108 `scripts/` and `apps/` source files without fetch errors. This is **not** a complete dynamic import/patch closure or an authenticated all-writer lock-coverage proof.

## Boundaries and next evidence

The result is `NEED_NATIVE_ALLOCATOR`, with `order_authorized=false`. The synthetic entry proves only a cross-language contract mismatch. The real Native8 preallocation and owner-priority invocation, independent operator trust root, real inventory/root/13 GateProof, sequence/freshness, all-writer account-lock coverage, cross-file atomic reconciliation, full dynamic import/patch closure, and Forward Shadow primary records remain unverified.

Do not alter existing 8 strategies, the old IDLE Core overlay, Production, or LIVE. Do not change client order IDs to allow same-symbol duplicates. Keep same-symbol, 12h cooldown, Shared Risk, Gross, Margin Guard, Kill Switch, Pending, account lock and dedup fail-closed. The previously rejected collision remains rejected; modeled entries without authentic proofs remain rejected. Do not perform economic Native8 10/30bps replay until primary authenticated evidence is available.

Research Owner: `IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH`. Research Route: `IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT`. Gross: `0.25x`. This report grants no order authority.
