"""Fail-closed V52 gross ownership reconciliation for Idle protected SHORTs."""
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from disdex_strict_portfolio_planner import (
    _validated_idle_owned_notional,
    quality102_crypto_notional_from_positions,
)

SHA="a"*40
NOW=int(time.time()*1000)
SIGNAL=NOW-3600_000
ENTRY=NOW-3500_000
def oid(action,symbol,ts):
    h=hashlib.sha256(f"IDLE_PRIORITY_SHORT|{action}|{symbol}|{ts}".encode()).hexdigest()[:22]
    return f"idle-{action.lower()}-{h}"[:36]
def pos(symbol,qty,price):
    return {
        "symbol":symbol,"side":"SHORT","signalTs":SIGNAL,"entryTs":ENTRY,
        "exitTs":ENTRY+24*3600_000,"entryPrice":price,"quantity":qty,
        "protectionVerified":True,"stopPrice":price*1.10,
        "takeProfitPrice":price*0.75,
        "stopClientOrderId":oid("STOP",symbol,SIGNAL),
        "takeProfitClientOrderId":oid("TP",symbol,SIGNAL),
    }
def venue(symbol,qty,price):
    return {"symbol":symbol,"positionAmt":-qty,"markPrice":price*0.97,
            "entryPrice":price}
class OwnerTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/"idle-state.json"
        self.state={"schema":"disdex-idle-priority-state/v2","runtimeSha":SHA,
            "updatedAt":NOW-120000,"pending":None,"manualReview":None,
            "positions":[pos("DOTUSDT",65.9,1.087),pos("JUPUSDT",225,0.3048)]}
        self.write()
        self.env=patch.dict(os.environ,{"DISDEX_RUNTIME_COMMIT_SHA":SHA,
            "DISDEX_IDLE_PRIORITY_STATE_PATH":str(self.path)})
        self.env.start();self.addCleanup(self.env.stop)
    def write(self):
        self.path.write_text(json.dumps(self.state))
    def check(self,sym="DOTUSDT",qty=65.9,price=1.087):
        rows=[venue(sym,qty,price)]
        return _validated_idle_owned_notional(sym,-qty,price*0.97,price,rows,now_ms=NOW)
    def test_valid_dot_and_jup_counted_as_exact_known_crypto(self):
        self.assertAlmostEqual(self.check(),65.9*1.087*0.97)
        rows=[venue("DOTUSDT",65.9,1.087),venue("JUPUSDT",225,0.3048)]
        self.assertAlmostEqual(
            quality102_crypto_notional_from_positions(rows,now_ms=NOW),
            65.9*1.087*0.97+225*0.3048*0.97)
    def test_protection_verification_required(self):
        self.state["positions"][0]["protectionVerified"]=False;self.write()
        with self.assertRaisesRegex(RuntimeError,"UNPROTECTED"):self.check()
    def test_unknown_unmanaged_symbol_still_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError,"Unknown non-flat"):
            quality102_crypto_notional_from_positions([venue("WIFUSDT",10,1)],now_ms=NOW)
    def test_mismatched_quantity_price_and_side_fail(self):
        with self.assertRaisesRegex(RuntimeError,"VENUE_QTY"):self.check(qty=60)
        with self.assertRaisesRegex(RuntimeError,"VENUE_ENTRY_PRICE"):self.check(price=1.1)
        with self.assertRaisesRegex(RuntimeError,"SYMBOL_OR_SIDE"):
            _validated_idle_owned_notional("DOTUSDT",65.9,1.0,1.087,
                [venue("DOTUSDT",65.9,1.087)],now_ms=NOW)
    def test_state_release_and_pending_must_match(self):
        self.state["runtimeSha"]="b"*40;self.write()
        with self.assertRaisesRegex(RuntimeError,"RELEASE_SHA"):self.check()
        self.state["runtimeSha"]=SHA;self.state["pending"]={"action":"ENTRY"};self.write()
        with self.assertRaisesRegex(RuntimeError,"PENDING_OR_MANUAL_REVIEW"):self.check()
    def test_stop_ids_and_hold_deadline(self):
        self.state["positions"][0]["stopClientOrderId"]="wrong";self.write()
        with self.assertRaisesRegex(RuntimeError,"PROTECTION_ID"):self.check()
        self.state["positions"][0]["stopClientOrderId"]=oid("STOP","DOTUSDT",SIGNAL)
        self.state["positions"][0]["exitTs"]=NOW-2*3600_000-1
        self.write()
        with self.assertRaisesRegex(RuntimeError,"STALE_OWNER"):self.check()
if __name__=="__main__":unittest.main()
