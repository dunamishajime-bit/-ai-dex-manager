"""V52 cannot be certified as native annual entries from ASTER M5+Yahoo H1 alone."""
from __future__ import annotations
from hashlib import sha256
import json
from pathlib import Path
import unittest
from scripts.research.stable4_v52_native_live_entry_source_gap import analyze, ROOT, BASES

EVIDENCE=ROOT/"docs/research/STABLE4_V52_NATIVE_ANNUAL_ENTRY_L2_SOURCE_GAP_20261128.json"

def validate(r):
    if (r.get("schema")!="stable4-v52-native-entry-required-market-data-gap/v1"
        or r.get("status")!="BLOCKED_NATIVE_ANNUAL_ENTRY_REPLAY_L2_AND_TIME_SYNC_UNAVAILABLE"
        or r.get("nativeEntryReplayComplete") is not False
        or r.get("sevenRunnerSharedWalletBtComplete") is not False
        or r.get("rootCertificateIssued") is not False
        or r.get("orderAuthority") is not False
        or r.get("productionEligible") is not False):
        raise ValueError("V52_FULL_NATIVE_OR_LIVE_SCOPE_FORGED")
    if set(r.get("perTicker",{}))!=set(BASES):raise ValueError("STOCK_UNIVERSE_DIFFERENT")
    if set(r.get("routeRequirements",{}))!={"V13D","V11EQ"}:
        raise ValueError("ROUTE_REQUIREMENT_MISSING")
    if not {"ASTER_L2_ORDER_BOOK","HYPERLIQUID_XYZ_L2_ORDER_BOOK"}<=set(r["routeRequirements"]["V13D"]):
        raise ValueError("NATIVE_HEDGE_L2_REQUIREMENTS_MISSING")
    if not {"CONTEMPORANEOUS_REFERENCE_QUOTE","ASTER_30S_SPREAD_HISTORY","ASTER_2S_MID_HISTORY"}<=set(r["routeRequirements"]["V11EQ"]):
        raise ValueError("NATIVE_MICROSTRUCTURE_REQUIREMENTS_MISSING")
    code=ROOT/r["sourceEngine"]
    if not code.is_file() or sha256(code.read_bytes()).hexdigest()!=r["engineSourceSha256"]:
        raise ValueError("NATIVE_SOURCE_ENGINE_CHANGED")
    for name,filename in (("m5_yahoo","STABLE4_V52_STOCK_ASTER5M_YAHOO1H_COVERAGE_20261128.json"),
                          ("session","STABLE4_V52_REGULAR_SESSION_LIQUIDITY_20261128.json")):
        data=(ROOT/"docs/research"/filename).read_bytes()
        if sha256(data).hexdigest()!=r["pinnedReceiptSha256"][name]:
            raise ValueError("MARKET_RECEIPT_SHA_CHANGED")
    for k,v in r["perTicker"].items():
        if v["aster5mRows"]!=105120 or v["yahooH1Rows"]!=1742 or v["regularSessionZeroVolumePct"]<=29:
            raise ValueError("V52_MARKET_LIQUIDITY_SCOPE_CHANGED")
        if v["nativeCurrentBookCoverageProven"] is not False or v["nativeVenueFillCoverageProven"] is not False:
            raise ValueError("FALSE_BOOK_OR_EXECUTION_PROOF")

class V52NativeEntrySourceGap(unittest.TestCase):
    def test_source_and_market_receipts(self):
        r=json.loads(EVIDENCE.read_bytes());validate(r)
        fresh=analyze()
        self.assertEqual(r,fresh)
    def test_reject_fabricated_live_replay(self):
        r=json.loads(EVIDENCE.read_bytes())
        for field in ("nativeEntryReplayComplete","sevenRunnerSharedWalletBtComplete","productionEligible","rootCertificateIssued","orderAuthority"):
            d=json.loads(json.dumps(r));d[field]=True
            with self.subTest(field=field),self.assertRaises(ValueError):validate(d)
    def test_reject_ohlc_as_signed_l2(self):
        r=json.loads(EVIDENCE.read_bytes())
        r["perTicker"]["AMZN"]["nativeVenueFillCoverageProven"]=True
        with self.assertRaises(ValueError):validate(r)
        r=json.loads(EVIDENCE.read_bytes())
        del r["routeRequirements"]["V13D"]["HYPERLIQUID_XYZ_L2_ORDER_BOOK"]
        with self.assertRaises(ValueError):validate(r)

if __name__=='__main__':unittest.main()
