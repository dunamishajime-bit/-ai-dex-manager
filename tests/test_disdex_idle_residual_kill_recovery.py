import importlib.util
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
PATH=ROOT/"scripts/ops/root/disdex-idle-residual-kill-recovery.py"
spec=importlib.util.spec_from_file_location("kill_recovery",PATH)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class KillRecoveryContractTest(unittest.TestCase):
    def test_released_pending_history_is_not_active(self):
        self.assertEqual(m.active_pending_count({"entries":[
            {"status":"RELEASED"},{"status":"released"},{"status":"RELEASED"},
        ]}),0)
        self.assertEqual(m.active_pending_count({"entries":[
            {"status":"RELEASED"},{"status":"PENDING"},{"status":"SUBMITTED"},
        ]}),2)

    def test_only_exact_recoverable_reason_allowed(self):
        good={"active":True,"action":"HOLD_PROTECTED","recoverable":True,
              "operator":"disdex-v52-aster-only",
              "reason":m.KNOWN_REASON_PREFIX+'{"message":"'+m.KNOWN_REASON_FRAGMENT+'"}'}
        m.validate_known_kill(good)
        for patch in (
            {"active":False},{"action":"FLATTEN_MANAGED"},{"recoverable":False},
            {"operator":"manual"},{"reason":"other"},
        ):
            bad=dict(good);bad.update(patch)
            with self.assertRaises(ValueError):
                m.validate_known_kill(bad)

    def test_flat_state_must_be_fresh_and_exact_owner(self):
        now=2_000_000_000_000
        state={"schema":"disdex-idle-residual-long-state/v1","runtimeSha":m.IDLE_SHA,
               "updatedAt":now-60_000,"position":None,"pending":None,"manualReview":None}
        m.validate_flat_fresh_state(state,now)
        for patch in (
            {"runtimeSha":"a"*40},{"updatedAt":now-21*60_000},{"position":{"symbol":"DOGEUSDT"}},
        ):
            bad=dict(state);bad.update(patch)
            with self.assertRaises(ValueError):
                m.validate_flat_fresh_state(bad,now)

    def test_venue_requires_exact_resident_stop(self):
        good={
          "status":"ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS",
          "ordersSent":0,"cancelsSent":0,"positionChangesSent":0,
          "positions":[{"symbol":"DOGEUSDT","positionSide":"BOTH","positionAmt":-226,
                        "entryPrice":0.08052}],
          "openOrders":[{"symbol":"DOGEUSDT","clientOrderId":m.KNOWN_STOP,
                         "type":"STOP_MARKET","side":"BUY","origQty":226,
                         "executedQty":0,"reduceOnly":True,"status":"NEW"}],
        }
        digest=m.validate_venue(good);self.assertEqual(len(digest),64)
        bad={**good,"openOrders":[{**good["openOrders"][0],"reduceOnly":False}]}
        with self.assertRaises(ValueError):m.validate_venue(bad)
        bad={**good,"openOrders":[]}
        with self.assertRaises(ValueError):m.validate_venue(bad)

if __name__=="__main__":unittest.main()
