#!/usr/bin/env python3
"""V52 safety regression: daily strategy loss must not disable existing exits.

Only the exact tick() method is compiled from the live runner source. No
imports, network, exchange clients, credentials, orders or deployment paths
are executed by this test.
"""
from __future__ import annotations

import ast
import datetime as dt
import pathlib
import types

ENGINE = pathlib.Path(__file__).resolve().parent / "disdex_v52_aster_only_legacy_engine.py"


def load_tick():
    source = ENGINE.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(ENGINE))
    klass = next(
        n for n in tree.body
        if isinstance(n, ast.ClassDef) and n.name == "V52AsterOnlyEngine"
    )
    tick = next(
        n for n in klass.body
        if isinstance(n, ast.FunctionDef) and n.name == "tick"
    )
    tick.decorator_list = []
    base = types.SimpleNamespace(
        NY=dt.timezone.utc,
        ny_seconds=lambda local=None: 13 * 3600 + 23 * 60,
        clock=lambda s: (
            int(s.split(":")[0]) * 3600
            + int(s.split(":")[1]) * 60
            + (int(s.split(":")[2]) if len(s.split(":")) == 3 else 0)
        ),
    )
    namespace = {
        "base": base,
        "V50_WINDOWS": ("10:00", "10:30", "12:00", "14:30"),
        "regular_us_equity_session": lambda local: True,
        "os": types.SimpleNamespace(
            getenv=lambda key, default=None: default
        ),
        "read_shared_crypto_daily_risk": lambda path: (True, "OK", {}),
    }
    exec(
        compile(ast.Module(body=[tick], type_ignores=[]), str(ENGINE), "exec"),
        namespace,
    )
    return namespace["tick"], namespace


class FakeRunner:
    def __init__(self, *, daily_held=False, verified_loss=False,
                 open_position=False, kill=None, live=False):
        self.daily_held = daily_held
        self.verified_loss = verified_loss
        self.open_position = open_position
        self.kill = kill
        self.live = live
        self.calls = []
        self.state = {"v11SignalBasis": 123, "v11Attempted": True, "v50Attempted": {}}

    def reset_days(self):
        self.calls.append("reset_days")

    def kill_switch(self):
        return self.kill

    def _flatten_kill_once(self, kill, reason):
        self.calls.append("flatten_kill")

    def _clear_kill_flatten_latch(self):
        self.calls.append("clear_kill_flatten")

    def enforce_daily_loss(self):
        self.calls.append("enforce_daily_loss")
        return self.daily_held

    def _refresh_v52_daily_flatten_intent(self):
        self.calls.append("refresh_scoped_flatten_intent")
        # Existing entry-latch scenarios simulate unverified API issues,
        # which must not initiate an automatic liquidation. A separate
        # explicit verified-loss case below must use the scoped flatten.
        return self.verified_loss

    def _finish_v52_daily_flatten(self):
        assert self.verified_loss, "ONLY_VERIFIED_V52_LOSS_MAY_FLATTEN"
        self.calls.append("v52_verified_loss_scoped_flatten")
        self.open_position = False

    def positions(self):
        return {"V50": {"symbol": "NVDA"}} if self.open_position else {}

    def log(self, event, **fields):
        self.calls.append(event)

    def update_history(self):
        self.calls.append("update_history")

    def v96_requires_margin(self):
        return False

    def manage_positions(self, rows):
        assert self.open_position
        self.calls.append("manage_positions")

    def _own_recoverable_hold(self):
        return None

    def books_and_refs(self):
        self.calls.append("books_and_refs")
        return {"NVDA": ("model-price", "model-ref", "model-ref")}

    def capture_v50_signal(self, *args):
        raise AssertionError("NO_NEW_ENTRY_SIGNAL_ON_TEST_TICK")

    def record_v11_signal(self, *args):
        raise AssertionError("NO_NEW_ENTRY_SIGNAL_ON_TEST_TICK")

    def open_basis_position(self, *args):
        raise AssertionError("NO_NEW_EXPOSURE_WHEN_STOPPED")

    def available_slot_gross(self, *args):
        raise AssertionError("NO_NEW_EXPOSURE_PLANNER_WHEN_STOPPED")


def main():
    tick, ns = load_tick()
    time = dt.datetime(2026, 11, 20, 13, 23, tzinfo=dt.timezone.utc)
    prepared = {"local": time, "rows": {"NVDA": ("data", "data", "data")}}
    # Entry latch must leave risk-reducing exit management reachable.
    held_position = FakeRunner(daily_held=True, open_position=True)
    tick(held_position, prepared)
    assert held_position.calls.count("manage_positions") == 1, held_position.calls
    assert "v52-strategy-daily-loss-exit-management-continues" in held_position.calls
    assert "v52-soft-hold-entry-blocked" in held_position.calls

    # A proven V52 daily loss is different from an unknown API failure:
    # it must retire V52-owned exposure through scoped exit, not leave it
    # managed indefinitely or permit a fresh entry in that same tick.
    tripped = FakeRunner(daily_held=True, verified_loss=True, open_position=True)
    tick(tripped, prepared)
    assert tripped.calls.count("v52_verified_loss_scoped_flatten") == 1, tripped.calls
    assert tripped.open_position is False
    assert "manage_positions" not in tripped.calls
    assert "update_history" not in tripped.calls
    assert "v52-soft-hold-entry-blocked" not in tripped.calls

    # The same latch must not permit an entry when flat.
    held_flat = FakeRunner(daily_held=True, open_position=False)
    tick(held_flat, prepared)
    assert "manage_positions" not in held_flat.calls
    assert "v52-strategy-daily-loss-flat-entry-held" in held_flat.calls
    assert "update_history" not in held_flat.calls

    # Ordinary position management remains unchanged when latch is clear.
    normal_position = FakeRunner(daily_held=False, open_position=True)
    tick(normal_position, prepared)
    assert normal_position.calls.count("manage_positions") == 1

    # Explicit flatten action still takes precedence over any other branch.
    flatten = FakeRunner(
        daily_held=True,
        open_position=True,
        kill={"action": "FLATTEN_MANAGED", "reason": "OWNER"},
    )
    tick(flatten, prepared)
    assert "flatten_kill" in flatten.calls
    assert "manage_positions" not in flatten.calls
    assert "enforce_daily_loss" not in flatten.calls

    # HOLD_PROTECTED blocks exposure without disabling an existing exit.
    hold = FakeRunner(
        daily_held=True,
        open_position=True,
        kill={"action": "HOLD_PROTECTED", "reason": "GRACE"},
    )
    tick(hold, prepared)
    assert hold.calls.count("manage_positions") == 1
    assert "v52-soft-hold-entry-blocked" in hold.calls

    # A shared-risk read failure also cannot suppress position management.
    ns["read_shared_crypto_daily_risk"] = lambda path: (False, "STALE", {})
    shared_block = FakeRunner(
        daily_held=False,
        open_position=True,
        live=True,
    )
    tick(shared_block, prepared)
    assert shared_block.calls.count("manage_positions") == 1
    assert "v52-soft-hold-entry-blocked" in shared_block.calls

    print("V52_UNVERIFIED_API_HOLD_EXISTING_EXITS_CONTINUE: PASS")
    print("V52_VERIFIED_3P5_LOSS_SCOPED_FLATTEN: PASS")
    print("V52_FLAT_HOLD_NEW_ENTRIES_BLOCKED: PASS")
    print("V52_BASELINE_MANAGE_POSITIONS: PASS")
    print("V52_KILL_FLATTEN_PRIORITY: PASS")
    print("V52_HOLD_PROTECTED_EXISTING_EXITS: PASS")
    print("V52_SHARED_RISK_STALE_EXISTING_EXITS: PASS")


if __name__ == "__main__":
    main()
