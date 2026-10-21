from __future__ import annotations

from disdex_v56_policy import (
    PENGU_LONG_MAX_REQUESTED_GROSS,
    PENGU_SHORT_MAX_REQUESTED_GROSS,
    V50_BASIS_STOP_MULTIPLE,
    V50_MAX_ADVERSE_BASIS_MOVE_BPS,
    V50_MAX_CONCURRENT_POSITIONS,
    V50_MAX_DAILY_ENTRIES,
    V50_MAX_HOLDING_HOURS,
    v11_requested_gross,
    v50_requested_gross,
)
import disdex_v12_v52_live_engine as production


# The supplied research artifact contains aggregate replay evidence, not the
# underlying event ledger.  This test therefore proves the exact production
# sizing/exit/gate contract against the frozen research handoff; it does not
# claim event-timestamp parity that the artifact cannot support.
assert production.V50_MIN_ENTRY_BASIS_BPS == 65.0
assert production.V50_MIN_NET_EDGE_BPS == 5.0
assert production.legacy.legacy.V50_MAX_HOLDING_HOURS == V50_MAX_HOLDING_HOURS == 4
assert production.legacy.legacy.V50_BASIS_STOP_MULTIPLE == V50_BASIS_STOP_MULTIPLE == 1.75
assert production.legacy.legacy.V50_MAX_ADVERSE_BASIS_MOVE_BPS == V50_MAX_ADVERSE_BASIS_MOVE_BPS == 10.0
assert production.V50_MAX_CONCURRENT_POSITIONS == V50_MAX_CONCURRENT_POSITIONS == 2
assert production.V50_MAX_DAILY_ENTRIES == V50_MAX_DAILY_ENTRIES == 3
assert PENGU_LONG_MAX_REQUESTED_GROSS == 0.9375
assert PENGU_SHORT_MAX_REQUESTED_GROSS == 0.75
assert v50_requested_gross(1, 65, 5) == 1.0
assert v50_requested_gross(1, 100, 15) == 1.25
assert v50_requested_gross(2, 85, 10) == 0.25
assert [v11_requested_gross(*row) for row in ((50, 0), (80, 10), (110, 20), (140, 30))] == [0.75, 1.0, 1.25, 1.5]

print("V56 production parity contract: PASS")
print("V56_PARITY_MODE=CONTRACT_PARITY_AGGREGATE_EVIDENCE")
print("V56_EVENT_TIMESTAMP_PARITY=UNAVAILABLE_FROM_RESEARCH_ARTIFACT")
print("PRODUCTION_TEST_ORDERS=0")
