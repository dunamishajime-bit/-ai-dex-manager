"""Pure Stable4 entry guard contract tests. Run with python -B."""
import copy
import unittest

from disdex_stable4_entry_gross_guard import (
    Stable4EntryGrossRejected, evaluate_stable4_entry_gross,
)


NOW = 1_800_000_000_000


def fixture():
    return {
        "now": NOW,
        "account": {"equityUsd": 100, "observedAt": NOW},
        "positions": [],
        "pendingRegistry": {"schema": "disdex-pending-exposure/v1", "accountScope": "ASTER_FUTURES", "updatedAt": NOW, "entries": []},
        "candidate": {"symbol": "BTCUSDT", "side": "LONG", "notionalUsd": 10},
    }


def pending(reservation="other", **changes):
    return dict({"reservationId": reservation, "strategyId": "V12", "sleeve": "CRYPTO", "symbol": "BTCUSDT", "side": "LONG", "gross": 999, "notionalUsd": 10, "status": "PENDING", "createdAt": NOW - 1000, "updatedAt": NOW}, **changes)


class EntryGrossTests(unittest.TestCase):
    def rejected(self, payload, code):
        with self.assertRaises(Stable4EntryGrossRejected) as caught:
            evaluate_stable4_entry_gross(payload)
        self.assertEqual(caught.exception.code, code)

    def test_exact_caps_pass_and_above_caps_reject_without_tolerance(self):
        for symbol, amount, code in [("BTC", 300, "CRYPTO_GROSS_CAP"), ("META", 150, "STOCK_GROSS_CAP")]:
            p = fixture()
            p["candidate"].update(symbol=symbol, notionalUsd=amount)
            self.assertTrue(evaluate_stable4_entry_gross(p)["allowed"])
            p["candidate"]["notionalUsd"] += 0.000000001
            self.rejected(p, code)
        p = fixture()
        p["positions"] = [{"symbol": "BTC", "quantity": -2, "markPrice": 100, "observedAt": NOW}]
        p["candidate"].update(symbol="META", notionalUsd=150)
        self.assertEqual(evaluate_stable4_entry_gross(p)["projectedGross"]["total"], 3.5)
        p["positions"][0]["quantity"] = -2.00000000001
        self.rejected(p, "TOTAL_GROSS_CAP")

    def test_marked_absolute_quantity_and_pending_actual_notional_current_equity(self):
        p = fixture()
        p["positions"] = [{"symbol": "ETH", "quantity": -2, "markPrice": 50, "observedAt": NOW}]
        p["pendingRegistry"]["entries"] = [pending(notionalUsd=25)]
        self.assertEqual(evaluate_stable4_entry_gross(p)["projectedGross"]["crypto"], 1.35)
        p["account"]["equityUsd"] = 50
        self.assertEqual(evaluate_stable4_entry_gross(p)["projectedGross"]["crypto"], 2.7)

    def test_all_other_pending_statuses_count_and_released_does_not(self):
        for status in ["PENDING", "SUBMITTED", "UNKNOWN"]:
            p = fixture()
            p["candidate"]["notionalUsd"] = 295
            p["pendingRegistry"]["entries"] = [pending(status=status)]
            self.rejected(p, "CRYPTO_GROSS_CAP")
        p["pendingRegistry"]["entries"][0]["status"] = "RELEASED"
        self.assertTrue(evaluate_stable4_entry_gross(p)["allowed"])

    def test_exact_own_reservation_counts_candidate_once_and_checks_identity(self):
        p = fixture()
        p["candidate"].update(notionalUsd=295, ownReservationId="mine")
        p["pendingRegistry"]["entries"] = [pending("mine", symbol="BTC", notionalUsd=295)]
        self.assertEqual(evaluate_stable4_entry_gross(p)["projectedGross"]["crypto"], 2.95)
        p["pendingRegistry"]["entries"].append(pending("other"))
        self.rejected(p, "CRYPTO_GROSS_CAP")
        p["pendingRegistry"]["entries"] = [pending("mine", side="SHORT")]
        self.rejected(p, "OWN_RESERVATION_MISMATCH")
        p["pendingRegistry"]["entries"] = []
        self.rejected(p, "OWN_RESERVATION_MISSING")

    def test_registry_corruption_fails_closed_including_released_rows(self):
        for changes, code in [({"status": "EXPIRED"}, "PENDING_STATUS_INVALID"), ({"gross": float("nan"), "status": "RELEASED"}, "NUMERIC_INVALID"), ({"sleeve": "STOCK"}, "PENDING_CLASSIFICATION_MISMATCH"), ({"strategyId": "UNKNOWN"}, "PENDING_OWNER_UNKNOWN"), ({"side": "FLAT"}, "PENDING_SIDE_INVALID")]:
            p = fixture()
            p["pendingRegistry"]["entries"] = [pending(**changes)]
            self.rejected(p, code)
        p = fixture()
        p["pendingRegistry"]["entries"] = [pending(), pending()]
        self.rejected(p, "PENDING_DUPLICATE")

    def test_freshness_boundary_and_future_timestamps(self):
        p = fixture()
        p["account"]["observedAt"] = NOW - 120000
        self.assertTrue(evaluate_stable4_entry_gross(p)["allowed"])
        for path in [("account", "observedAt"), ("pendingRegistry", "updatedAt")]:
            for stamp in [NOW - 120001, NOW + 1, 0]:
                p = fixture()
                p[path[0]][path[1]] = stamp
                self.rejected(p, "TIMESTAMP_INVALID")
        p = fixture()
        p["positions"] = [{"symbol": "BTC", "quantity": 1, "markPrice": 1, "observedAt": NOW - 120001}]
        self.rejected(p, "TIMESTAMP_INVALID")
        p = fixture()
        p["pendingRegistry"]["entries"] = [pending(updatedAt=NOW - 120001, createdAt=NOW - 200000)]
        self.rejected(p, "TIMESTAMP_INVALID")

    def test_strict_numbers_reject_coercion_and_nonfinite(self):
        for bad in [None, True, False, "", "100", float("inf"), float("nan")]:
            for target, field in [("account", "equityUsd"), ("candidate", "notionalUsd")]:
                p = fixture()
                p[target][field] = bad
                self.rejected(p, "NUMERIC_INVALID")
        for field in ["quantity", "markPrice"]:
            p = fixture()
            p["positions"] = [{"symbol": "BTC", "quantity": 1, "markPrice": 1, "observedAt": NOW}]
            p["positions"][0][field] = "1"
            self.rejected(p, "NUMERIC_INVALID")

    def test_classifier_unknown_nonflat_rejects_and_canonical_universe_works(self):
        for symbol in ["META/USDT", "BTC-USDT", "FET", "HYPE", "ZEC", "TAO", "PENGU"]:
            p = fixture()
            p["candidate"]["symbol"] = symbol
            self.assertTrue(evaluate_stable4_entry_gross(p)["allowed"])
        p["candidate"]["symbol"] = "UNKNOWN"
        self.rejected(p, "UNKNOWN_SYMBOL")
        p = fixture()
        p["positions"] = [{"symbol": "UNKNOWN", "quantity": 1, "markPrice": 1, "observedAt": NOW}]
        self.rejected(p, "UNKNOWN_SYMBOL")
        p["positions"][0]["quantity"] = 0
        self.assertTrue(evaluate_stable4_entry_gross(p)["allowed"])
        p = fixture()
        p["candidate"]["symbol"] = "CUSTOM"
        self.assertTrue(evaluate_stable4_entry_gross(p, classifier=lambda symbol: "STOCK")["allowed"])

    def test_inputs_are_not_mutated(self):
        p = fixture()
        original = copy.deepcopy(p)
        evaluate_stable4_entry_gross(p)
        self.assertEqual(p, original)

    def test_malformed_json_field_shapes_raise_typed_rejections(self):
        for field, bad, code in [("status", [], "PENDING_STATUS_INVALID"), ("side", {}, "PENDING_SIDE_INVALID")]:
            p = fixture()
            p["pendingRegistry"]["entries"] = [pending(**{field: bad})]
            self.rejected(p, code)
        p = fixture()
        p["symbolSleeves"] = {"CUSTOM": []}
        p["candidate"]["symbol"] = "CUSTOM"
        self.rejected(p, "UNKNOWN_SYMBOL")

    def test_released_flat_rows_validate_but_do_not_reserve(self):
        p = fixture()
        p["pendingRegistry"]["entries"] = [pending(side="FLAT", status="RELEASED", updatedAt=NOW - 200000, createdAt=NOW - 300000)]
        self.assertEqual(evaluate_stable4_entry_gross(p)["projectedGross"]["crypto"], 0.1)

    def test_approved_qhv_positions_count_as_crypto_for_account_admission(self):
        for symbol in ["SUI", "SEI", "APT", "ARB", "OP", "ENA", "ONDO", "FIL", "TRX"]:
            p = fixture()
            p["positions"] = [{"symbol": symbol, "quantity": 2, "markPrice": 5, "observedAt": NOW}]
            self.assertEqual(evaluate_stable4_entry_gross(p)["projectedGross"]["crypto"], 0.2)


if __name__ == "__main__":
    unittest.main()
