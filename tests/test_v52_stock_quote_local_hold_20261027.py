#!/usr/bin/env python3
"""No-venue regression of stock-quote staleness isolation on the V52 runner."""
import ast
from pathlib import Path
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "scripts" / "disdex_v52_aster_only_legacy_engine.py"
tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
helper = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "is_brief_local_stock_quote_staleness")
cls = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "V52AsterOnlyEngine")
method = next(node for node in cls.body if isinstance(node, ast.FunctionDef) and node.name == "_local_quote_stale_retry")
target = ast.fix_missing_locations(ast.Module(body=[
    helper,
    ast.ClassDef(name="V52Fake", bases=[], keywords=[], body=[method], decorator_list=[]),
], type_ignores=[]))


class Clock:
    value = 1_000_000

    @staticmethod
    def now_ms():
        return Clock.value


scope = {"base": Clock}
exec(compile(target, str(SOURCE), "exec"), scope)
short_stale = scope["is_brief_local_stock_quote_staleness"]
FakeBase = scope["V52Fake"]
STALE = 'HTTP 503 http://127.0.0.1:8797/quote?symbol=TSLA: {"error":"stale_quote","ageMs":32286,"maximumAgeMs":30000}'


class Harness(FakeBase):
    def __init__(self, holding=True):
        self.holding = holding
        self._stock_quote_stale_since_ms = 0
        self._upstream_fail_closed_hold = False
        self.events = []
    def positions(self):
        return {"V50": {"symbol": "TSLA"}} if self.holding else {}
    def log(self, event, **kwargs):
        self.events.append((event, kwargs))


class QuoteRecoveryContract(unittest.TestCase):
    def setUp(self):
        Clock.value = 1_000_000

    def test_only_exact_local_staleness_is_scoped(self):
        self.assertTrue(short_stale(STALE))
        self.assertFalse(short_stale('HTTP 503 http://127.0.0.1:8797/quote?symbol=TSLA: {"error":"quote_unavailable"}'))
        self.assertFalse(short_stale("ASTER_GLOBAL_RATE_BUDGET_SATURATED"))
        self.assertFalse(short_stale("Managed Stock quantity reconciliation mismatch"))

    def test_brief_stale_keeps_position_and_pauses_entry(self):
        a = Harness()
        self.assertTrue(a._local_quote_stale_retry(STALE, "PRELOCK"))
        self.assertTrue(a._upstream_fail_closed_hold)
        self.assertEqual(a.events[-1][0], "v52-local-quote-stale-retry")
        self.assertFalse(a.events[-1][1]["newOrdersAllowed"])
        self.assertTrue(a.events[-1][1]["existingPositionsRetained"])

    def test_sustained_stale_escalates_instead_of_bypassing_safety(self):
        a = Harness()
        self.assertTrue(a._local_quote_stale_retry(STALE, "TICK"))
        Clock.value += 15 * 60_000
        self.assertFalse(a._local_quote_stale_retry(STALE, "TICK"))
        self.assertEqual(a.events[-1][0], "v52-local-quote-stale-escalate-account-hold")

    def test_flat_retry_never_places_orders(self):
        a = Harness(holding=False)
        self.assertTrue(a._local_quote_stale_retry(STALE, "PRELOCK"))
        self.assertFalse(a.events[-1][1]["newOrdersAllowed"])


if __name__ == "__main__":
    unittest.main()
