# V12 V4 actual execution implementation plan — 2026-10-09
User instruction: repair incomplete execution, certify, then enable LIVE only after adoption and execution conditions pass. The existing 41-route case is the source; no silent strategy replacement.
1. Update foreign inventory on authenticated account marks; count foreign unfilled reservations; journal actual adverse-price fills before blocking new entries.
2. Add durable intent/state store with replay verification, atomic fsync/CAS, and deterministic order IDs including route/leg.
3. Reuse existing Aster order, account-lock, quantity, 5x Cross, Kill Switch and reduce-only protection primitives. Never use Shadow order flags as authority.
4. Persist intent before submission. Unknown responses keep reservation and query the same order; no automatic resend on -2013.
5. Reconcile cumulative fills from distinct venue trade IDs, protect any filled quantity, and handle restart/partial fill/protection fill/Exit without cancelling other owners.
6. Build persistent runner for completed H2 native sources, completed H1 delayed repairs, priority, Exit/cooldown, shared ownership/risk snapshots.
7. Compare full 8 event execution and market/quantity/funding, independent research adoption, Linux tests/build. Deploy/activate only upon full certification. Known DD/external-PF failures are retained; do not manufacture PASS.
