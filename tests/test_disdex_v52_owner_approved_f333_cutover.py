import importlib.util
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
PATH=ROOT/"scripts/ops/deploy/disdex_v52_owner_approved_f333_cutover.py"
spec=importlib.util.spec_from_file_location("v52f333",PATH)
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

class V52F333CutoverContractTest(unittest.TestCase):
    def test_inventory_ignores_mark_only_changes_but_binds_protection(self):
        a={"positions":[{"symbol":"DOGEUSDT","positionAmt":"-2","positionSide":"BOTH",
                         "entryPrice":"1","markPrice":"2","updateTime":1}],
           "openOrders":[{"symbol":"DOGEUSDT","orderId":7,"clientOrderId":"s","status":"NEW",
                          "side":"BUY","positionSide":"BOTH","type":"STOP_MARKET",
                          "reduceOnly":True,"closePosition":False,"origQty":"2",
                          "executedQty":"0","stopPrice":"3","updateTime":1}]}
        b={"positions":[dict(a["positions"][0],markPrice="99",updateTime=2)],
           "openOrders":[dict(a["openOrders"][0],updateTime=2)]}
        self.assertEqual(m.inventory_digest(m.normalize_inventory(a)),
                         m.inventory_digest(m.normalize_inventory(b)))
        b["openOrders"][0]["stopPrice"]="4"
        self.assertNotEqual(m.inventory_digest(m.normalize_inventory(a)),
                            m.inventory_digest(m.normalize_inventory(b)))

    def test_flat_inventory_is_valid(self):
        value=m.normalize_inventory({"positions":[],"openOrders":[]})
        self.assertEqual(value,{"positions":[],"openOrders":[]})
        self.assertEqual(len(m.inventory_digest(value)),64)

    def test_zero_positions_are_excluded(self):
        value=m.normalize_inventory({"positions":[{"symbol":"X","positionAmt":"0"}],"openOrders":[]})
        self.assertEqual(value["positions"],[])

    def test_missing_position_amount_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError,"POSITION_AMT_INVALID"):
            m.normalize_inventory({"positions":[{"symbol":"X"}],"openOrders":[]})

    def test_metadata_updates_only_v52_and_keeps_orders_off(self):
        import json
        pins={"schema":"x","runners":{"V52":{"sha":m.OLD,"serviceUnit":m.OLD_UNIT,
             "releaseRoot":str(m.BASE/m.OLD)},"Q":{"sha":"q"}}}
        next_pins=json.loads(m.next_runner_pins((json.dumps(pins)+"\n").encode()))
        self.assertEqual(next_pins["runners"]["V52"]["sha"],m.NEW)
        self.assertEqual(next_pins["runners"]["Q"]["sha"],"q")
        plan={"ordersEnabled":False,"runners":{"V52":m.OLD,"Q":"q"}}
        next_plan=json.loads(m.next_current_plan((json.dumps(plan)+"\n").encode()))
        self.assertEqual(next_plan["runners"]["V52"],m.NEW)
        self.assertEqual(next_plan["runners"]["Q"],"q")
        self.assertIs(next_plan["ordersEnabled"],False)

    def test_activation_is_exact_sha_owner_and_hold_scoped(self):
        value=m.build_activation("12345","dunamishajime-bit","a"*64)
        self.assertEqual(value["approvedSha"],m.NEW)
        self.assertTrue(value["ordersEnabled"])
        self.assertIn("V52",value["approvedRunners"])
        self.assertEqual(value["authorizationMethod"],"GITHUB_ACTIONS_PRODUCTION_ENVIRONMENT")
        self.assertTrue(value["evidence"]["killSwitchActive"])
        self.assertTrue(value["evidence"]["startUnderProtectedHold"])
        self.assertEqual(value["evidence"]["inventoryDigest"],"a"*64)
        with self.assertRaisesRegex(RuntimeError,"GITHUB_ACTOR"):
            m.build_activation("12345","other","a"*64)

    def test_exact_production_transition_is_bound(self):
        self.assertEqual(m.OLD,"4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81")
        self.assertEqual(m.NEW,"f33301be4805969333a5c580feaa38b72f825236")
        self.assertNotEqual(m.OLD,m.NEW)

if __name__=="__main__":
    unittest.main()
