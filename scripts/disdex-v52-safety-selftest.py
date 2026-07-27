import inspect
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import disdex_v13d_v11eq_stock_live_engine as base
import disdex_v52_execution_safety_patch as safety


book = base.Book(
    "ASTER",
    "AMZNUSDT",
    99.9,
    1000,
    100.1,
    1000,
    [(99.9, 1000)],
    [(100.1, 1000)],
    10,
    20,
)
assert base.passive_exit_price(book, "SELL") == 100.1
assert base.passive_exit_price(book, "BUY") == 99.9
assert base.urgent_exit_reason("BASIS_STOP")
assert base.urgent_exit_reason("FINAL_1530")
assert not base.urgent_exit_reason("BASIS_CONVERGED")
assert 'category="ASTER_SIGNED"' in inspect.getsource(safety.V52AsterClient._signed)


class DummyResponse:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return b"{}"


original_urlopen = safety.urllib.request.urlopen
previous_cooldowns = dict(base._API_COOLDOWN_UNTIL_MS)
try:
    safety.urllib.request.urlopen = lambda *_args, **_kwargs: DummyResponse()
    now = base.now_ms()
    base._API_COOLDOWN_UNTIL_MS.update(
        {
            "ASTER_PUBLIC": now + 60_000,
            "REFERENCE": now + 60_000,
            "ASTER_SIGNED": 0,
        }
    )
    assert safety._request_json(
        "https://fapi3.asterdex.com/fapi/v3/order",
        category="ASTER_SIGNED",
    ) == {}
finally:
    safety.urllib.request.urlopen = original_urlopen
    base._API_COOLDOWN_UNTIL_MS.clear()
    base._API_COOLDOWN_UNTIL_MS.update(previous_cooldowns)


client = object.__new__(base.AsterClient)
client._rules = {
    "AMZNUSDT": {
        "status": "TRADING",
        "step": 0.01,
        "minQty": 0.01,
        "maxQty": 1000,
        "tick": 0.01,
        "minNotional": 5.0,
    }
}
assert client.normalize(
    "AMZNUSDT",
    0.1,
    10.0,
    "SELL",
    reduce_only=True,
)[0] == 0.1
try:
    client.normalize("AMZNUSDT", 0.1, 10.0, "SELL")
except RuntimeError:
    pass
else:
    raise AssertionError("entry below minNotional must fail")


class GrossEngine:
    minimum_entry_usd = 5.0
    stock_gross_cap = 1.5
    portfolio_gross_cap = 2.5
    v11_gross_cap = 1.0
    v50_gross_cap = 1.0
    gross_tolerance = 0.03
    state = {"positions": {}}

    def positions(self):
        return self.state["positions"]

    def v96_requires_margin(self):
        return False

    def gross_snapshot(self):
        return {
            "equityUsd": 100.0,
            "availableBalanceUsd": 58.7,
            "crossWalletBalanceUsd": 100.0,
            "unrealizedPnlUsd": 0.0,
            "cryptoNotionalUsd": 100.0,
            "stockNotionalUsd": 100.0,
            "cryptoGross": 1.0,
            "stockGross": 1.0,
            "totalGross": 2.0,
        }

    execution_capacity_gross = safety._execution_capacity_gross


gross_engine = GrossEngine()
gross, audit = safety._available_slot_gross(
    gross_engine,
    safety.V50_SLOT,
)
assert 0 < gross <= 0.5
assert audit["finalExecutionGross"] == gross
assert audit["projectedTotalGross"] <= 2.5
assert audit["requiredInitialMarginUsd"] == 0.0
assert audit["availableBalanceSource"] == "ASTER_REPORTED_FREE_MARGIN"


class Quote:
    def __init__(self, price):
        now = base.now_ms()
        self.price = price
        self.timestamp_ms = now
        self.received_ms = now


class RecheckAster:
    def __init__(self, mid):
        self.mid = mid

    def book(self, _symbol, _limit):
        return base.Book(
            "ASTER",
            "AMZNUSDT",
            self.mid - 0.01,
            100000,
            self.mid + 0.01,
            100000,
            [(self.mid - 0.01, 100000)],
            [(self.mid + 0.01, 100000)],
            base.now_ms(),
            base.now_ms(),
        )


class RecheckReference:
    last_timestamp_fallback = False

    def quote(self, _symbol):
        return Quote(100.0)


class RecheckEngine:
    v11_notional = 50.0
    gross_tolerance = 0.03
    aster_maker_fee_bps = 0.0
    aster_taker_fee_bps = 0.0
    v11_safety_buffer_bps = 0.0

    def __init__(self, mid):
        self.aster = RecheckAster(mid)
        self.reference = RecheckReference()
        self.logs = []

    def estimate_v11_cost(self, _book, _exit_action, _notional):
        return 0.0, {}

    def available_slot_gross(self, _slot):
        return 1.0, {
            "cryptoGross": 0.0,
            "stockGross": 0.0,
            "totalGross": 0.0,
        }

    def gross_snapshot(self):
        return {
            "cryptoGross": 0.0,
            "stockGross": 0.0,
            "totalGross": 0.0,
        }

    def log(self, event, **payload):
        self.logs.append((event, payload))


v50_candidate = {
    "symbol": "AMZN",
    "side": "SELL",
    "basisBps": 80.0,
    "signalBasisBps": 80.0,
    "expectedGross": 0.5,
    "expectedNotionalUsd": 50.0,
}
try:
    safety._recheck_entry_conditions(
        RecheckEngine(100.74),
        v50_candidate,
        slot=safety.V50_SLOT,
        actual_notional_usd=50.0,
    )
except RuntimeError as error:
    assert "75bps" in str(error)
else:
    raise AssertionError("V50 74bps must fail")

safety._recheck_entry_conditions(
    RecheckEngine(100.75),
    v50_candidate,
    slot=safety.V50_SLOT,
    actual_notional_usd=50.0,
)

v11_candidate = {
    "symbol": "AMZN",
    "side": "SELL",
    "basisBps": 55.0,
    "signalBasisBps": 55.0,
    "expectedGross": 0.5,
    "expectedNotionalUsd": 50.0,
}
try:
    safety._recheck_entry_conditions(
        RecheckEngine(100.49),
        v11_candidate,
        slot=safety.V11_SLOT,
        actual_notional_usd=50.0,
    )
except RuntimeError as error:
    assert "50bps" in str(error)
else:
    raise AssertionError("V11 49bps must fail")


class FakeFill:
    def __init__(self, executed_qty, requested_qty, status="FILLED"):
        self.executed_qty = executed_qty
        self.requested_qty = requested_qty
        self.status = status
        self.client_id = "test"
        self.average_price = 100.0

    @property
    def fill_ratio(self):
        return self.executed_qty / self.requested_qty


class ExitAster:
    def __init__(self):
        self.poll_called = False
        self.market_calls = []

    def book(self, _symbol, _limit):
        return book

    def place_limit(self, **_kwargs):
        raise RuntimeError("GTX order would immediately match")

    def poll_fill(self, *_args, **_kwargs):
        self.poll_called = True
        raise AssertionError("GTX rejected order must not be polled")

    def place_market(self, **kwargs):
        self.market_calls.append(kwargs)
        return FakeFill(kwargs["quantity"], kwargs["quantity"])

    def positions(self):
        return [{"symbol": "AMZNUSDT", "positionAmt": "0"}]

    def open_orders(self, _symbol):
        return []

    def rules(self, _symbol):
        return {"step": 0.01}


class ExitEngine:
    live = True
    state = {
        "positions": {
            safety.V50_SLOT: {
                "symbol": "AMZN",
                "asterOpenSide": "BUY",
                "asterQty": 1.0,
                "asterEntryPrice": 100.0,
            }
        }
    }

    def __init__(self):
        self.aster = ExitAster()
        self.saved = 0
        self.logs = []
        self.state = {
            "positions": {
                safety.V50_SLOT: {
                    "symbol": "AMZN",
                    "asterOpenSide": "BUY",
                    "asterQty": 1.0,
                    "asterEntryPrice": 100.0,
                }
            }
        }

    def positions(self):
        return self.state["positions"]

    def client_id(self, _slot, _symbol, action):
        return f"stock-v52-test-{action.lower()}"

    def _set_pending(self, payload):
        self.state["pendingOrder"] = payload

    def _clear_pending(self):
        self.state["pendingOrder"] = None

    def save(self):
        self.saved += 1

    def log(self, event, **payload):
        self.logs.append((event, payload))


exit_engine = ExitEngine()
safety._close_slot(
    exit_engine,
    safety.V50_SLOT,
    "BASIS_CONVERGED",
)
assert not exit_engine.aster.poll_called
assert len(exit_engine.aster.market_calls) == 1
assert exit_engine.aster.market_calls[0]["reduce_only"] is True
assert "close-taker" in exit_engine.aster.market_calls[0]["client_id"]
assert safety.V50_SLOT not in exit_engine.positions()
assert exit_engine.state["pendingOrder"] is None

print("DISDEX_V52_SAFETY_SELFTEST_OK")
