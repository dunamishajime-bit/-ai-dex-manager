from __future__ import annotations

from disdex_v56_policy import (
    PENGU_LONG_MAX_REQUESTED_GROSS,
    PENGU_SHORT_MAX_REQUESTED_GROSS,
    V50_BASIS_STOP_MULTIPLE,
    V50_MAX_ADVERSE_BASIS_MOVE_BPS,
    V50_MAX_CONCURRENT_POSITIONS,
    V50_MAX_DAILY_ENTRIES,
    V50_MAX_HOLDING_HOURS,
    V50_RANK1_NORMAL_GROSS,
    V50_RANK1_STRONG_GROSS,
    V50_RANK2_GROSS,
    v11_requested_gross,
    v50_requested_gross,
)


def reserve(global_cap: float, current: float, reserved: float, requested: float):
    available = global_cap - current - reserved
    if requested > available:
        return False, reserved
    return True, reserved + requested


assert PENGU_LONG_MAX_REQUESTED_GROSS == 0.9375
assert PENGU_SHORT_MAX_REQUESTED_GROSS == 0.75
assert v50_requested_gross(1, 65, 5) == V50_RANK1_NORMAL_GROSS == 1.0
assert v50_requested_gross(1, 100, 15) == V50_RANK1_STRONG_GROSS == 1.25
assert v50_requested_gross(2, 85, 10) == V50_RANK2_GROSS == 0.25
assert v50_requested_gross(2, 84.999, 10) is None
assert v50_requested_gross(2, 85, 9.999) is None
assert [v11_requested_gross(*row) for row in ((50, 0), (80, 10), (110, 20), (140, 30))] == [0.75, 1.0, 1.25, 1.5]
assert V50_MAX_HOLDING_HOURS == 4
assert V50_BASIS_STOP_MULTIPLE == 1.75
assert V50_MAX_ADVERSE_BASIS_MOVE_BPS == 10.0
assert V50_MAX_CONCURRENT_POSITIONS == 2
assert V50_MAX_DAILY_ENTRIES == 3

# Two concurrent reservations are accepted only while the combined hard cap
# remains intact; no partial allocation or forced exit is part of this model.
ok, reserved = reserve(2.5, 1.0, 0.0, 1.25)
assert ok and reserved == 1.25
ok, reserved_after_rejected = reserve(2.5, 1.0, reserved, 0.25)
assert ok and 1.0 + reserved_after_rejected == 2.5
ok, unchanged = reserve(2.5, 2.5, 0.0, 0.25)
assert not ok and unchanged == 0.0

print("V56 policy safety/parity self-test: PASS")
print("PRODUCTION_TEST_ORDERS=0")
print("PRODUCTION_CANCELS=0")
print("PRODUCTION_SETTLES=0")
