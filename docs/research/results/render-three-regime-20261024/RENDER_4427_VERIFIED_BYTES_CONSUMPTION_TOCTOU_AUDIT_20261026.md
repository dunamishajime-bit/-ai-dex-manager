# RENDER #4427 — verified-byte consumption / post-verification TOCTOU boundary (2026-10-26)

**STATUS: RESEARCH_SYNTHETIC_METADATA_TO_CONSUMPTION_GAP_CONFIRMED / NATIVE8_NOT_INTEGRATED / FAIL_CLOSED**

## New audited finding

The earlier research-only signed composed-plan verifier (`render4427_signed_composed_patch_research_20261026.py`) authenticates a source snapshot and an ordered final digest, but its successful return value contains **only metadata**, not the final verified executable bytes. A subsequent consumer that reopens a mutable path may therefore read bytes different from those that were authenticated. This is a **research interface/TOCTOU gap**, not evidence that the real Native8 or LIVE runner has been exploited or uses such a consumer.

A synthetic source file was verified, then replaced with different bytes in an authorized scratch directory **without executing the source**. The old verifier's earlier success and final hash remained unchanged, while a new read of the path yielded a different input hash. The test does not claim the old verifier authorized orders; it explicitly never did.

## Research-only mitigation

New pure adapter `scripts/dd-reduction/render4427_verified_bytes_consumption_research_20261026.py` calls the existing signed composed verifier and then reconstructs every signed ordered stage **from the same immutable input bytes**, rechecking stage digests and the signed plus independently supplied final digest. It returns a frozen `VerifiedResearchBytes` record containing the exact final `payload: bytes` and SHA256. A later path reread remains **outside** this boundary; a future trusted runtime consumer would need to use the returned payload itself, not import/reopen the path. The adapter never executes/imports target source, changes globals, sends orders or modifies Native8.

## Owner-PC independent verification

- Authorized research-only PC directory: `C:/Users/dis/render4427-research-only/verified-bytes-20261026`.
- GitHub branch: `research/render4427-verified-byte-consumption-boundary-20261026` (new isolated branch from prior research commit `ef3c1968ed29c2b023d9e23552e6b810534398c6`).
- GitHub original Python source and tests were downloaded to the authorized directory; their SHA256s are recorded in the canonical JSON.
- Synthetic tests: **12 tests × normal/-O/-OO × two independent Python processes = 72/72 PASS**.
- An independent auditor script was itself run in two separate PC Python processes, both exit 0 and both produced the same canonical JSON SHA256:
  `8b8470927b0a8f5688307e547c54309bc206192f8288acddbc8d1b4304395d0d`.
- Auditor script SHA256 on PC: `dadcf97988327dc3282bc1f5b4ee945d3b1846f4f9a7207cbc0e119e39d849da`.
- Tests include the metadata-only gap, synthetic file swap, immutable returned payload, frozen record, ordered final bytes, invalid signature, source drift, wrong independent key/final pins, and no order authorization.
- Reproduce without running target code: `python scripts/dd-reduction/audit_render4427_verified_bytes_consumption_20261026.py --scratch <authorized-existing-research-directory>`.

## Strict limitations and next steps

The signer and source in the tests are **synthetic**. No candidate-independent operator trust root, complete dynamic import/patch closure, runtime path and output path freeze, or actual Native8 consumption of the verified bytes has been authenticated. In particular, **the adapter does not make an import-by-path safe**, does not prevent a caller from ignoring the payload, and does not close all dynamic import/monkey-patch TOCTOU windows. Source provenance and full runtime closure must be proven independently before any trusted consumption.

Actual Native8 preallocation/owner-priority inventory, source identity, monotonic sequence, as-of/freshness, atomic durable dedup, independent Owner/Route registration and 13 GateProof origins remain unauthenticated. Research Owner `IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH`, Route `IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT`, and IDLE 0.25x are not live-registered. The historical modeled entries remain unapproved, including the required same-symbol rejection; no new economic replay or Forward Shadow certification was done. No previously explored period is represented as pristine OOS.

**No VPS/LIVE/Production/HP/real orders/current-eight-strategy/old IDLE Core `_overlay_block`/dirty worktree changes.** No risk, same-symbol, 12h cooldown, pending, Shared Risk, Gross, Margin Guard, Kill Switch, account lock, or dedup bypass. No LIVE adoption.

Next: trace an independent operator trust root and an immutable **complete** runtime closure (external untracked task8, third/fourth roots, Git-external brain/bank, dynamic patch, module-scope mutations, runtime/output paths). Establish a trusted consumer of the exact verified bytes, then identify authoritative Native8 preallocation and all 13 as-of GateProof origins. Until proven, Fail Closed.
