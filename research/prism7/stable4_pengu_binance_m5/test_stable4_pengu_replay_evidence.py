"""Self-contained validation of the STABLE4/PENGU 10/30bps evidence package."""
import csv
import hashlib
import io
import json
from pathlib import Path
import unittest
import zipfile

D = Path(__file__).resolve().parent
M = json.loads((D / "STABLE4_PENGU_BINANCE_ASTERM5_10_30BPS_FINAL_RESEARCH_MANIFEST_20261123.json").read_text(encoding="utf8"))
ZIP = D / "STABLE4_REPLAY_PAIR_COMPLETE_RESEARCH_LEDGER_20261123.zip"

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

class Stable4Evidence(unittest.TestCase):
    def test_source_and_p90_p91_adoption(self):
        self.assertEqual(M["grossPolicy"]["totalCap"], 4.25)
        self.assertTrue(M["baselineReproducedOriginalStable4ExactBothCostCases"])
        self.assertTrue(M["notLiveSignedExecutionParity"])
        src = (D / "PENGU_P91_4_BINANCE_M5_ADOPTED_INTENTS.jsonl").read_bytes()
        self.assertEqual(sha(src), M["PENGU_TAPE_SHA256"])
        rows = [json.loads(x) for x in src.decode("utf8").splitlines() if x.strip()]
        self.assertEqual(len(rows), 4)
        self.assertEqual([x["requestedGross"] for x in rows], [0.75] * 4)
        self.assertTrue(all(x["signedExecutionVerified"] is False for x in rows))
        self.assertTrue(all(x["marketDataDecisionScore5"] >= 2 for x in rows))
        self.assertTrue(all(x["entryTs"] >= x["sourceNativeEntryHourTs"] + 300000 for x in rows))
        for k in ("BASE_WRAPPER", "NEW_WRAPPER"):
            path = D / M["copiedSources"][k]["filename"]
            self.assertEqual(sha(path.read_bytes()), M["copiedSources"][k]["sha256"])
            compile(path.read_text(encoding="utf8"), str(path), "exec")

    def test_all_42_original_output_files_sha_attested(self):
        self.assertTrue(M["copiedSources"]["FULL_LEDGER"]["githubStored"])
        self.assertEqual(sha(ZIP.read_bytes()), M["copiedSources"]["FULL_LEDGER"]["sha256"])
        with zipfile.ZipFile(ZIP) as f:
            self.assertEqual(len(f.namelist()), 42)
            for label, originals in M["sourceOutputFilesSHA256"].items():
                for name, meta in originals.items():
                    raw = f.read(label + "/" + name)
                    self.assertEqual(len(raw), meta["bytes"], (label, name))
                    self.assertEqual(sha(raw), meta["sha256"], (label, name))

    def test_strategy_and_dd21_path(self):
        out = M["outputs"]
        self.assertEqual(out["10"]["base"]["modeled_fills"], 795)
        self.assertEqual(out["10"]["penguBinanceAsterM5"]["modeled_fills"], 802)
        self.assertEqual(out["30"]["base"]["modeled_fills"], 791)
        self.assertEqual(out["30"]["penguBinanceAsterM5"]["modeled_fills"], 466)
        self.assertEqual(out["30"]["base"]["blocked_by_reason"]["V4_MAX_DRAWDOWN_21PCT_HOLD"], 683)
        self.assertEqual(out["30"]["penguBinanceAsterM5"]["blocked_by_reason"]["V4_MAX_DRAWDOWN_21PCT_HOLD"], 1214)
        dd = json.loads((D / "STABLE4_PENGU_BIN5_FIRST_DD21_REPLAY_20261123.json").read_text(encoding="utf8"))
        self.assertEqual(dd["BASE_30"]["firstOver21Utc"], "2026-03-02T06:55:00Z")
        self.assertEqual(dd["PENGU_BIN5_30"]["firstOver21Utc"], "2025-11-10T10:00:00Z")
        with zipfile.ZipFile(ZIP) as z:
            for bps in (10, 30):
                fills = next(n for n in z.namelist() if n.startswith("PENGU_BIN5/") and n.endswith(f"_{bps}BPS_FILLS.csv"))
                rows = list(csv.DictReader(io.StringIO(z.read(fills).decode("utf-8-sig"))))
                pen = [r for r in rows if r["strategy"] == "PENGU" and r["route"] == "SHORT_V20"]
                self.assertEqual(len(pen), 4)
                self.assertTrue(all(float(r["gross_x"]) == 0.75 for r in pen))
                self.assertEqual(sum(float(r["net_pnl_jpy"]) > 0 for r in pen), 1)
                self.assertTrue(all(r["signed_execution_verified"] == "False" for r in pen))

    def test_v52_expost_not_native_orderbook(self):
        v = json.loads((D / "STABLE4_V52_84_H1_PROXY_VS_SAVED_M5_PRINT_DIAGNOSTIC_20261123.json").read_text(encoding="utf8"))
        self.assertTrue(v["onlyExPostLiquidityDiagnostics"])
        self.assertTrue(v["historicalAsterL2QuoteDepthMissing"])
        self.assertTrue(v["noAsterSignedFills"])
        for bps in ("10", "30"):
            a = v["summaryByBps"][bps]
            self.assertEqual(a["modeledV52Fills"], 84)
            self.assertEqual(a["noPrintInEntryM5"], 56)
            self.assertEqual(len(a["tradeEvidenceRows"]), 84)
            self.assertTrue(all(r["signedFillVerified"] is False for r in a["tradeEvidenceRows"]))

if __name__ == "__main__":
    unittest.main()
