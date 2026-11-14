"""Read-only V4 venue/STOP reconciliation; test fixtures contain no credentials."""
import copy,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_v4_readonly_protection_audit import audit

SHA="7"*40
ID="DOGEUSDT:REC_X05_TIME_36H:SHORT:1794650400000"
STOP="v12-v4-95d1f28b06eaedcb5939752030be"

def evidence(active=False):
    ledger={
      "releaseSha":SHA,
      "state":{"legs":{ID:{"status":"OPEN","qty":301,"entryNotional":18.94494,"candidate":{"symbol":"DOGEUSDT","effectiveSide":"SHORT"}}}},
      "intents":{STOP:{"legId":ID,"action":"STOP","clientOrderId":STOP,"command":{"price":0.06798}}},
      "protections":{ID:{"legId":ID,"phase":"STOP_CONFIRMED","protectedQty":301,"stopClientOrderId":STOP}},
    }
    venue={
      "status":"ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS","venueTime":1794652000000,
      "ordersSent":0,"cancelsSent":0,"positionChangesSent":0,
      "positions":[{"symbol":"DOGEUSDT","positionAmt":-301,"entryPrice":0.06294}],
      "openOrders":[{"symbol":"DOGEUSDT","clientOrderId":STOP,"status":"NEW","side":"BUY","type":"STOP_MARKET",
                     "reduceOnly":True,"origQty":"301","executedQty":"0"}]
    }
    status="loaded active running" if active else "loaded failed failed"
    services=f"disdex-v12-v4@{SHA}.service {status} test\n"
    return ledger,venue,services

def stop_detail():
    return {"status":"READ_ONLY_ORDER","id":STOP,"symbol":"DOGEUSDT",
            "orderStatus":"NEW","type":"STOP_MARKET","side":"BUY","reduceOnly":True,
            "quantity":"301","executed":"0","stopPrice":"0.067980","ordersSent":0,"cancelsSent":0}

class ProtectionAuditTests(unittest.TestCase):
    def test_protected_but_runner_failed(self):
        result=audit(*evidence(),stop_detail=stop_detail())
        self.assertEqual(result["status"],"PROTECTED_BUT_RUNNER_NOT_RUNNING")
        self.assertTrue(result["stopPriceVerified"])
        self.assertAlmostEqual(result["positions"][0]["stopPrice"],0.06798)
        self.assertEqual(result["positions"][0]["qty"],301)
        self.assertFalse(result["tradeAuthorityProvided"])
    def test_running_is_not_trading_certification(self):
        result=audit(*evidence(True),stop_detail=stop_detail())
        self.assertEqual(result["status"],"PROTECTION_MATCHED_RUNNER_RUNNING_NOT_TRADE_CERTIFIED")
        self.assertFalse(result["tradeAuthorityProvided"])
    def test_price_evidence_absence_cannot_be_called_fully_protected(self):
        result=audit(*evidence())
        self.assertEqual(result["status"],"RUNNER_NOT_RUNNING_STOP_PRICE_UNVERIFIED")
        self.assertFalse(result["stopPriceVerified"])
    def test_wrong_stop_price_rejected(self):
        d=stop_detail();d["stopPrice"]="0.068"
        with self.assertRaisesRegex(ValueError,"STOP_PRICE_LEDGER_VENUE_MISMATCH"):audit(*evidence(),stop_detail=d)
    def test_stop_price_not_protective_rejected(self):
        a,b,c=evidence()
        a["intents"][STOP]["command"]["price"]=0.05
        d=stop_detail();d["stopPrice"]="0.05"
        with self.assertRaisesRegex(ValueError,"STOP_PRICE_NOT_PROTECTIVE"):audit(a,b,c,d)
    def test_signed_stop_detail_identity_required(self):
        d=stop_detail();d["id"]="forged"
        with self.assertRaisesRegex(ValueError,"STOP_DETAIL_IDENTITY_OR_TYPE_MISMATCH"):audit(*evidence(),stop_detail=d)
    def test_missing_venue_stop_rejected(self):
        a,b,c=evidence();b["openOrders"]=[]
        with self.assertRaisesRegex(ValueError,"VENUE_STOP_MISSING"):audit(a,b,c)
    def test_wrong_quantity_rejected(self):
        a,b,c=evidence();b["positions"][0]["positionAmt"]=-300
        with self.assertRaisesRegex(ValueError,"VENUE_POSITION_LEDGER_MISMATCH"):audit(a,b,c)
    def test_reduce_only_required(self):
        a,b,c=evidence();b["openOrders"][0]["reduceOnly"]=False
        with self.assertRaisesRegex(ValueError,"VENUE_STOP_PROTECTION_INVALID"):audit(a,b,c)
    def test_stop_direction_required(self):
        a,b,c=evidence();b["openOrders"][0]["side"]="SELL"
        with self.assertRaisesRegex(ValueError,"VENUE_STOP_PROTECTION_INVALID"):audit(a,b,c)
    def test_stop_type_required(self):
        a,b,c=evidence();b["openOrders"][0]["type"]="LIMIT"
        with self.assertRaisesRegex(ValueError,"VENUE_STOP_PROTECTION_INVALID"):audit(a,b,c)
    def test_protection_phase_required(self):
        a,b,c=evidence();a["protections"][ID]["phase"]="ENTRY_SENT"
        with self.assertRaisesRegex(ValueError,"LEDGER_PROTECTION_MISSING"):audit(a,b,c)
    def test_no_mutation_proof_required(self):
        a,b,c=evidence();b["ordersSent"]=1
        with self.assertRaisesRegex(ValueError,"SIGNED_GET_MUST_BE_READ_ONLY"):audit(a,b,c)
    def test_missing_systemd_service_rejected(self):
        a,b,c=evidence()
        with self.assertRaisesRegex(ValueError,"SERVICE_IDENTITY"):audit(a,b,"")
    def test_incomplete_venue_response_rejected(self):
        a,b,c=evidence();del b["cancelsSent"]
        with self.assertRaisesRegex(ValueError,"SIGNED_GET_MUST_BE_READ_ONLY"):audit(a,b,c)
    def test_stop_quantity_matched(self):
        a,b,c=evidence();b["openOrders"][0]["origQty"]="201"
        with self.assertRaisesRegex(ValueError,"VENUE_STOP_QUANTITY_INVALID"):audit(a,b,c)

if __name__=="__main__":unittest.main()