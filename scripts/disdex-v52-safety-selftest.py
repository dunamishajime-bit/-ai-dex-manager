import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import disdex_v13d_v11eq_stock_live_engine as base

book = base.Book("ASTER", "AMZNUSDT", 99.9, 10, 100.1, 10, [], [], 10, 20)
assert base.passive_exit_price(book, "SELL") == 100.1
assert base.passive_exit_price(book, "BUY") == 99.9
assert base.urgent_exit_reason("BASIS_STOP")
assert base.urgent_exit_reason("FINAL_1530")
assert not base.urgent_exit_reason("BASIS_CONVERGED")
assert base.api_category("https://fapi.asterdex.com/fapi/v1/depth", None) == "ASTER_PUBLIC"
assert base.api_category("https://quotes.example.test/AMZN", None) == "REFERENCE"
assert base.transient_error_class("REFERENCE", 429) == "TRANSIENT_REFERENCE_DATA"
client = object.__new__(base.AsterClient)
client._rules = {"AMZNUSDT": {"status": "TRADING", "step": 0.01, "minQty": 0.01, "maxQty": 1000, "tick": 0.01, "minNotional": 5.0}}
assert client.normalize("AMZNUSDT", 0.1, 10.0, "SELL", reduce_only=True)[0] == 0.1
try:
    client.normalize("AMZNUSDT", 0.1, 10.0, "SELL")
except RuntimeError:
    pass
else:
    raise AssertionError("entry below minNotional must fail")
print("DISDEX_V52_SAFETY_SELFTEST_OK")
