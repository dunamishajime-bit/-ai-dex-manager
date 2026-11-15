"""Independent durable-owner and signed-inventory binding contract tests."""
import copy
import hashlib
import json
import unittest

from disdex_v4_nonflat_ownership import attest_sole_v4_inventory


SHA = "a" * 40
OLD_SHA = "b" * 40
TS = 1794672000000


def cid(sha, leg, action="STOP", sequence=0):
    raw = json.dumps([sha, leg, action, sequence], separators=(",", ":"))
    return "v12-v4-" + hashlib.sha256(raw.encode()).hexdigest()[:28]


def fixture(count=1, legacy=False):
    doc = {"schema": 2, "releaseSha": SHA, "revision": 7,
           "state": {"initial": {"holdProtected": False, "foreign": [], "equityUsd": 100},
                     "foreign": [], "legs": {}, "journal": []}, "intents": {}, "protections": {}}
    if legacy:
        doc["legacyReleaseShas"] = [OLD_SHA]
    orders = []
    for index in range(count):
        leg = f"BNBUSDT:REC_X04_TIME_24H:SHORT:{TS + index}"
        stop_cid = cid(OLD_SHA if legacy else SHA, leg)
        doc["state"]["legs"][leg] = {
            "id": leg, "status": "OPEN", "qty": 0.02, "reservationUsd": 0,
            "entryTs": TS + index, "exitRemainingQty": 0,
            "candidate": {"symbol": "BNBUSDT", "effectiveSide": "SHORT", "eligibleEntryTs": TS + index}}
        doc["intents"][stop_cid] = {
            "clientOrderId": stop_cid, "legId": leg, "action": "STOP", "sequence": 0,
            "stage": "ACKNOWLEDGED", "createdAt": TS + index, "updatedAt": TS + index,
            "venueOrderId": str(2673737086 + index),
            "command": {"legId": leg, "action": "STOP", "sequence": 0, "symbol": "BNBUSDT",
                        "positionSide": "SHORT", "quantity": 0.02, "price": 650, "signalTs": TS + index}}
        doc["protections"][leg] = {"legId": leg, "phase": "STOP_CONFIRMED", "protectedQty": 0.02,
                                   "stopClientOrderId": stop_cid, "updatedAt": TS + index}
        orders.append({"symbol": "BNBUSDT", "clientOrderId": stop_cid, "orderId": 2673737086 + index,
                       "side": "BUY", "type": "STOP_MARKET", "status": "NEW", "reduceOnly": True,
                       "origQty": "0.02", "executedQty": "0", "stopPrice": "650", "positionSide": "BOTH"})
    positions = [{"symbol": "BNBUSDT", "positionAmt": str(-0.02 * count), "markPrice": "640",
                  "entryPrice": "630", "positionSide": "BOTH"}]
    return doc, positions, orders


class SoleV4OwnershipTests(unittest.TestCase):
    def assert_rejected(self, doc, positions, orders):
        with self.assertRaises(ValueError):
            attest_sole_v4_inventory(doc, SHA, positions, orders)

    def test_terminal_zero_quantity_history_allows_only_the_reducers_roundoff_residual(self):
        doc,positions,orders=fixture()
        historical={"id":"historical","qty":0,"status":"CLOSED","reservationUsd":0,"exitRemainingQty":3.552713678800501e-15}
        doc["state"]["legs"]["historical"]=historical
        self.assertTrue(attest_sole_v4_inventory(doc,SHA,positions,orders)["verified"])
        historical["exitRemainingQty"]=1e-11
        self.assert_rejected(doc,positions,orders)

    def test_one_and_two_same_symbol_legs_have_exact_independent_stop_owners(self):
        for count in [1, 2]:
            doc, positions, orders = fixture(count)
            proof = attest_sole_v4_inventory(doc, SHA, positions, orders)
            self.assertTrue(proof["verified"])
            self.assertEqual(proof["verifiedLegs"], count)
            self.assertEqual(proof["uniqueStopOrders"], count)
            self.assertEqual(proof["positionSymbols"], ["BNBUSDT"])
            self.assertEqual(len(proof["proofSha256"]), 64)
            self.assertFalse(proof["journalReplayVerified"])

    def test_legacy_sha_stop_identity_is_valid_only_with_explicit_lineage(self):
        doc, positions, orders = fixture(legacy=True)
        self.assertTrue(attest_sole_v4_inventory(doc, SHA, positions, orders)["verified"])
        del doc["legacyReleaseShas"]
        self.assert_rejected(doc, positions, orders)

    def test_wrong_release_schema_and_bad_lineage_fail(self):
        for changes in [{"releaseSha": OLD_SHA}, {"schema": True}, {"revision": True},
                        {"legacyReleaseShas": [SHA]}, {"legacyReleaseShas": [OLD_SHA, OLD_SHA]},
                        {"legacyReleaseShas": ["bad"]}]:
            doc, positions, orders = fixture()
            doc.update(changes)
            self.assert_rejected(doc, positions, orders)

    def test_hold_review_foreign_and_reservations_fail(self):
        for kind in ["hold", "review", "foreign_qty", "foreign_gross", "foreign_pending", "reservation", "pending_leg", "pending_exit"]:
            doc, positions, orders = fixture()
            leg = next(iter(doc["state"]["legs"].values()))
            if kind == "hold": doc["state"]["initial"]["holdProtected"] = True
            elif kind == "review": doc["state"]["executionReview"] = "needs review"
            elif kind.startswith("foreign"):
                row = {"owner": "OTHER", "symbol": "ETHUSDT", "side": "LONG", "qty": 0, "gross": 0, "pendingGross": 0, "crypto": True}
                row[{"foreign_qty": "qty", "foreign_gross": "gross", "foreign_pending": "pendingGross"}[kind]] = 1
                doc["state"]["foreign"] = [row]
            elif kind == "reservation": leg["reservationUsd"] = 1
            elif kind == "pending_leg": leg["status"] = "PENDING_ENTRY"
            else: leg["status"] = "PENDING_EXIT"
            self.assert_rejected(doc, positions, orders)

    def test_unresolved_entry_intents_and_other_active_mutation_intents_fail(self):
        for action in ["ENTRY", "EXIT", "TAKE_PROFIT"]:
            for stage in ["PREPARED", "SUBMITTING", "UNKNOWN", "ACKNOWLEDGED"]:
                doc, positions, orders = fixture()
                original = next(iter(doc["intents"].values()))
                other = copy.deepcopy(original)
                other.update(action=action, stage=stage, clientOrderId=cid(SHA, original["legId"], action))
                other["command"]["action"] = action
                doc["intents"][other["clientOrderId"]] = other
                self.assert_rejected(doc, positions, orders)

    def test_position_quantity_side_foreign_and_duplicate_rows_fail(self):
        for kind in ["qty", "sign", "hedge", "missing", "foreign", "duplicate", "tiny_foreign"]:
            doc, positions, orders = fixture()
            if kind == "qty": positions[0]["positionAmt"] = "-0.019"
            elif kind == "sign": positions[0]["positionAmt"] = "0.02"
            elif kind == "hedge": positions[0]["positionSide"] = "SHORT"
            elif kind == "missing": positions.clear()
            elif kind == "duplicate": positions.append(copy.deepcopy(positions[0]))
            else: positions.append({"symbol": "ETHUSDT", "positionAmt": "1e-100" if kind == "tiny_foreign" else "1", "markPrice": "1", "entryPrice": "1", "positionSide": "BOTH"})
            self.assert_rejected(doc, positions, orders)

    def test_opposing_same_symbol_legs_cannot_net_to_venue_position(self):
        doc, positions, orders = fixture(2)
        next(iter(doc["state"]["legs"].values()))["candidate"]["effectiveSide"] = "LONG"
        positions[0]["positionAmt"] = "0"
        self.assert_rejected(doc, positions, orders)

    def test_stop_protection_and_command_bindings_fail_on_any_drift(self):
        for field, value in [("legId", "foreign"), ("action", "EXIT"), ("sequence", 1),
                             ("symbol", "ETHUSDT"), ("positionSide", "LONG"), ("quantity", 0.03),
                             ("price", 651), ("signalTs", TS + 1)]:
            doc, positions, orders = fixture()
            next(iter(doc["intents"].values()))["command"][field] = value
            self.assert_rejected(doc, positions, orders)
        for field, value in [("phase", "STOP_SENT_UNKNOWN"), ("protectedQty", 0.01),
                             ("stopClientOrderId", "other"), ("legId", "other")]:
            doc, positions, orders = fixture()
            next(iter(doc["protections"].values()))[field] = value
            self.assert_rejected(doc, positions, orders)

    def test_venue_stop_order_must_be_exact_new_unexecuted_reduce_only(self):
        for field, value in [("symbol", "ETHUSDT"), ("clientOrderId", "other"), ("orderId", 1),
                             ("type", "LIMIT"), ("side", "SELL"), ("status", "PARTIALLY_FILLED"),
                             ("reduceOnly", "true"), ("reduceOnly", 1), ("origQty", "0.03"),
                             ("executedQty", "1e-100"), ("stopPrice", "650.00000000001"),
                             ("positionSide", "SHORT")]:
            doc, positions, orders = fixture()
            orders[0][field] = value
            self.assert_rejected(doc, positions, orders)

    def test_missing_extra_duplicate_and_shared_stop_are_rejected(self):
        for kind in ["missing", "extra", "duplicate", "duplicate_id", "shared"]:
            doc, positions, orders = fixture(2 if kind in {"shared", "duplicate_id"} else 1)
            if kind == "missing": orders.clear()
            elif kind == "extra": orders.append(dict(orders[0], clientOrderId="foreign", orderId=1))
            elif kind == "duplicate": orders.append(copy.deepcopy(orders[0]))
            elif kind == "duplicate_id": orders[1]["orderId"] = orders[0]["orderId"]
            else:
                protections = list(doc["protections"].values())
                protections[1]["stopClientOrderId"] = protections[0]["stopClientOrderId"]
            self.assert_rejected(doc, positions, orders)

    def test_intent_cid_recomputed_and_acknowledgement_required(self):
        for kind in ["cid", "stage", "venue_order", "missing_command", "missing_protection"]:
            doc, positions, orders = fixture()
            intent = next(iter(doc["intents"].values()))
            if kind == "cid": intent["sequence"] = 1
            elif kind == "stage": intent["stage"] = "TERMINAL"
            elif kind == "venue_order": del intent["venueOrderId"]
            elif kind == "missing_command": del intent["command"]
            else: doc["protections"].clear()
            self.assert_rejected(doc, positions, orders)

    def test_malformed_numeric_values_never_become_zero(self):
        for bad in [None, True, False, "", " ", "nan", "inf", "no", [], {}]:
            for target in ["position", "order", "leg", "foreign"]:
                doc, positions, orders = fixture()
                if target == "position": positions[0]["positionAmt"] = bad
                elif target == "order": orders[0]["executedQty"] = bad
                elif target == "leg": next(iter(doc["state"]["legs"].values()))["qty"] = bad
                else: doc["state"]["foreign"] = [{"qty": bad, "gross": 0, "pendingGross": 0}]
                self.assert_rejected(doc, positions, orders)

    def test_zero_positions_only_are_ignored_and_quantity_tolerance_is_bounded(self):
        doc, positions, orders = fixture()
        positions.append({"positionAmt": "0"})
        positions[0]["positionAmt"] = "-0.020000001"
        self.assertTrue(attest_sole_v4_inventory(doc, SHA, positions, orders)["verified"])
        positions[0]["positionAmt"] = "-0.02000002"
        self.assert_rejected(doc, positions, orders)

    def test_proof_canonical_record_and_inputs_are_immutable_and_bound(self):
        doc, positions, orders = fixture(2)
        before = copy.deepcopy((doc, positions, orders))
        first = attest_sole_v4_inventory(doc, SHA, positions, orders)
        second = attest_sole_v4_inventory(doc, SHA, list(reversed(positions)), list(reversed(orders)))
        self.assertEqual(first["proofSha256"], second["proofSha256"])
        self.assertEqual(hashlib.sha256(first["proofJson"].encode()).hexdigest(), first["proofSha256"])
        binding = json.loads(first["proofJson"])["bindings"][0]
        self.assertEqual({field: binding[field] for field in ["type", "status", "reduceOnly", "executedQty", "positionSide", "orderSide"]},
                         {"type": "STOP_MARKET", "status": "NEW", "reduceOnly": True, "executedQty": "0", "positionSide": "BOTH", "orderSide": "BUY"})
        self.assertEqual((doc, positions, orders), before)
        doc["revision"] += 1
        self.assertNotEqual(attest_sole_v4_inventory(doc, SHA, positions, orders)["proofSha256"], first["proofSha256"])

    def test_hold_flags_at_document_or_state_cannot_bypass_initial_hold_check(self):
        doc, positions, orders = fixture()
        doc["holdProtected"] = True
        self.assert_rejected(doc, positions, orders)

    def test_long_leg_opposite_sell_stop_and_positive_position_are_supported(self):
        doc, positions, orders = fixture()
        leg_id = next(iter(doc["state"]["legs"]))
        doc["state"]["legs"][leg_id]["candidate"]["effectiveSide"] = "LONG"
        next(iter(doc["intents"].values()))["command"]["positionSide"] = "LONG"
        positions[0]["positionAmt"] = "0.02"
        orders[0]["side"] = "SELL"
        self.assertTrue(attest_sole_v4_inventory(doc, SHA, positions, orders)["verified"])

    def test_distinct_symbol_legs_and_historical_terminal_entry_are_supported(self):
        doc, positions, orders = fixture(2)
        legs = list(doc["state"]["legs"].values())
        second_leg = legs[1]
        second_leg["candidate"]["symbol"] = "ETHUSDT"
        intent = doc["intents"][orders[1]["clientOrderId"]]
        intent["command"]["symbol"] = "ETHUSDT"
        orders[1]["symbol"] = "ETHUSDT"
        positions[0]["positionAmt"] = "-0.02"
        positions.append(dict(positions[0], symbol="ETHUSDT"))
        entry = copy.deepcopy(next(iter(doc["intents"].values())))
        entry.update(action="ENTRY", stage="TERMINAL", clientOrderId=cid(SHA, entry["legId"], "ENTRY"))
        entry["command"]["action"] = "ENTRY"
        doc["intents"][entry["clientOrderId"]] = entry
        proof = attest_sole_v4_inventory(doc, SHA, positions, orders)
        self.assertEqual(proof["positionSymbols"], ["BNBUSDT", "ETHUSDT"])

    def test_non_json_data_and_malformed_container_shapes_raise_value_error(self):
        for bad in [None, True, "", [], 1]:
            doc, positions, orders = fixture()
            doc["intents"] = bad
            self.assert_rejected(doc, positions, orders)
        doc, positions, orders = fixture()
        doc["state"]["equityUsd"] = float("nan")
        self.assert_rejected(doc, positions, orders)


if __name__ == "__main__":
    unittest.main()
