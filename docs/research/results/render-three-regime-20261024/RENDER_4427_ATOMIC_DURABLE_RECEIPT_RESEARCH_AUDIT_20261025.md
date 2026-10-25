# RENDER #4427 — local atomic receipt research audit (2026-10-25)

**RESEARCH ONLY — no Native8 or LIVE authorization.**

## Newly audited
- 14 new synthetic tests and 42 existing contract/authenticity tests: 56/56 PASS in each of two fresh Python processes.
- Eight concurrent independent Python processes submitted the same synthetic receipt to one local SQLite DB: exactly one research-only claim; seven replays rejected.
- A fresh Python process rejected the same receipt after the original process ended; sequence gaps, backward sequence and conflicting payloads were rejected.
- The journal uses SQLite WAL, BEGIN IMMEDIATE, synchronous FULL, and unique constraints; success is RECORDED_RESEARCH_ONLY_NOT_AUTHORIZED, never an order permit.

## Primary source boundary
The research producer uses native.research_new_rows=inject and self-asserted generic_accepted/route_selected=True, with a research label as source_runtime_sha. These are not independently authenticated Native8 Owner/Route proofs.

## Limits / Fail Closed
This local DB test does not establish power-loss resilience, cross-host atomicity, source identity, trusted root, 13 as-of safety proofs, venue order execution, or full Native8 integration. Do not treat synthetic receipts as historical proof for June 23/25; May 27 stays rejected due same-symbol position conflict. The Native8 pipeline, current eight strategies, VPS, LIVE, Production, HP, and real orders were not modified. No new economic BT.

The 2025 Aster RENDER H1 mark gap and actual Aster M5 fill/Funding verification gaps remain. Historical 2025H2 is explored, not untouched OOS. No new Forward Shadow primary evidence was established.

## Reproduce
Run scripts/dd-reduction/audit_render_4427_atomic_receipt_20261025.py from a fresh Python process. It executes all synthetic suites twice and emits deterministic JSON.
