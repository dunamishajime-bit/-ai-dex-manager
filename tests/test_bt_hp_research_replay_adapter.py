"""Evidence adapter regression tests; synthetic fixtures only, no trading calls."""
import csv
import gzip
import json
import sys
import subprocess
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_research_replay_adapter import Source, convert, resolve_gross_caps

class ReplayAdapterTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
    def write(self,name,rows):
        p=self.root/name
        with p.open("w",encoding="utf-8",newline="") as fh:
            w=csv.DictWriter(fh,fieldnames=rows[0].keys())
            w.writeheader();w.writerows(rows)
        return p
    def equity(self,bad_gross=False):
        return self.write("equity.csv",[
            dict(utc="2025-10-01T00:00:00Z",compounded_mtm_equity_jpy="10000",wallet_cash_jpy="10000",crypto_gross_x="0",stock_gross_x="0",total_gross_x="0"),
            dict(utc="2025-10-01T01:00:00Z",compounded_mtm_equity_jpy="10070",wallet_cash_jpy="10000",crypto_gross_x="1",stock_gross_x="0",total_gross_x="0.2" if bad_gross else "1"),
            dict(utc="2025-10-01T02:00:00Z",compounded_mtm_equity_jpy="10150",wallet_cash_jpy="10150",crypto_gross_x="0",stock_gross_x="0",total_gross_x="0"),
        ])
    def fills(self):
        return self.write("fills.csv",[dict(
            trade_id="trade_1",strategy="V4",symbol="BTCUSDT",side="LONG",
            entry_utc="2025-10-01T01:00:00Z",exit_utc="2025-10-01T02:00:00Z",
            net_pnl_jpy="150",
            model_entry_price="100000",notional_jpy="10000",gross_x="1"
        )])
    def test_canonical_gross_is_used_and_position_mark_unknown(self):
        out=convert(Source(self.equity(),self.fills(),None),dict(total=3.5,crypto=3,stock=1.5),interval_minutes=60)
        self.assertEqual(len(out["frames"]),3)
        mid=out["frames"][1]
        self.assertEqual(mid["gross"]["totalX"],1)
        self.assertEqual(mid["positions"][0]["logic"],"V4")
        self.assertIsNone(mid["positions"][0]["mark"])
        self.assertIsNone(mid["positions"][0]["gross"])
        self.assertEqual(mid["positions"][0]["grossAtEntry"],1)
        self.assertIn("ENTRY",mid["events"][0])
        self.assertEqual(out["frames"][2]["positions"],[])
        self.assertEqual(out["frames"][2]["realized"],150)
        self.assertEqual(out["source"]["grossCapEvidence"],"USER_SUPPLIED_NOT_VERIFIED")
    def test_btc_candles_do_not_use_unclosed_prices(self):
        p=self.root/"btc.jsonl.gz"
        with gzip.open(p,"wt",encoding="utf-8") as fh:
            # Opening 00:00 UTC; its close is only known at 01:00 UTC.
            fh.write(json.dumps([1759276800000,"100","120","90","110","1",1759280399999])+"\n")
            fh.write(json.dumps([1759280400000,"110","135","108","125","1",1759283999999])+"\n")
        out=convert(Source(self.equity(),self.fills(),None,btc_candles=p),dict(total=3.5,crypto=3,stock=1.5))
        self.assertIsNone(out["frames"][0]["btc"])
        self.assertEqual(out["frames"][1]["btc"],110)
        self.assertEqual(out["frames"][2]["btc"],125)
        self.assertEqual(len(out["btcCandles"]),2)
        self.assertTrue(out["source"]["btcCandlesSha256"])
    def test_catalog_never_claims_current_latest_pin(self):
        fills=self.fills()
        out=convert(Source(self.equity(),fills,None),dict(total=3.5,crypto=3,stock=1.5))
        catalog=out["strategyCatalog"]
        self.assertEqual([entry["logic"] for entry in catalog],["V4"])
        self.assertEqual(catalog[0]["status"],"RESEARCH_SOURCE_UNVERIFIED")
        self.assertEqual(catalog[0]["trades"],1)

    def test_source_manifest_caps_override_invalid_manual_guess(self):
        summary=self.root/"RUN_MANIFEST.json"
        summary.write_text(json.dumps({
            "status":"RESEARCH_ONLY",
            "results":[
                {"case":"CASE_A","cost_bps_roundtrip":10,"total_cap":4.25,"crypto_cap":3.0,
                 "stock_cap":4.0,"modeled_fills":1},
                {"case":"CASE_A","cost_bps_roundtrip":30,"total_cap":3.5,"crypto_cap":3.0,
                 "stock_cap":1.5,"modeled_fills":1}
            ]
        }),encoding="utf-8")
        source=Source(self.equity(),self.fills(),summary)
        limits,kind,meta=resolve_gross_caps(source,cost_bps=10)
        self.assertEqual(limits,{"total":4.25,"crypto":3.0,"stock":4.0})
        self.assertEqual(kind,"SOURCE_SUMMARY_MATCHED_RESEARCH_ONLY")
        self.assertEqual(meta["researchCase"],"CASE_A")
        with self.assertRaisesRegex(ValueError,"Gross cap mismatch"):
            resolve_gross_caps(source,total=4.75,cost_bps=10)
        self.assertEqual(resolve_gross_caps(source,cost_bps=30)[0]["total"],3.5)
    def test_missing_case_is_rejected(self):
        summary=self.root/"RUN_MANIFEST.json"
        summary.write_text(json.dumps({"results":[{"cost_bps_roundtrip":10,
            "total_cap":3.5,"crypto_cap":3,"stock_cap":1.5}]}),encoding="utf-8")
        source=Source(self.equity(),self.fills(),summary)
        with self.assertRaisesRegex(ValueError,"No unique source manifest case"):
            resolve_gross_caps(source,cost_bps=30)
    def test_partial_close_preserves_entry_and_records_last_model_gross(self):
        path=self.write("partials.csv",[{
            "utc":"2025-10-01T01:30:00Z",
            "trade_id":"trade_1","strategy":"V4","symbol":"BTCUSDT",
            "closed_fraction_of_current":"0.5",
            "remaining_gross_x":"0.5"
        }])
        out=convert(Source(self.equity(),self.fills(),None,partial_events=path),
                    dict(total=3.5,crypto=3,stock=1.5),interval_minutes=60)
        item=out["frames"][2]["positions"]
        self.assertEqual(len(item),0)
        active=out["frames"][1]["positions"]
        # Entry snapshot precedes the partial event: entry exposure remains unchanged.
        self.assertEqual(active[0]["grossAtEntry"],1)
        self.assertIn("PARTIAL",out["frames"][2]["events"][0])
        self.assertTrue(out["source"]["partialEventsSha256"])
    def test_partial_and_final_close_same_tick_preserves_both_events(self):
        path=self.write("partials.csv",[{
            "utc":"2025-10-01T02:00:00Z","trade_id":"trade_1",
            "strategy":"V4","symbol":"BTCUSDT",
            "closed_fraction_of_current":"0.5","remaining_gross_x":"0.5"
        }])
        out=convert(Source(self.equity(),self.fills(),None,partial_events=path),
                    dict(total=3.5,crypto=3,stock=1.5),interval_minutes=60)
        end_events=out["frames"][-1]["events"]
        self.assertEqual(len(out["frames"][-1]["positions"]),0)
        self.assertTrue(any("PARTIAL" in e for e in end_events))
        self.assertTrue(any("EXIT" in e for e in end_events))
    def test_partial_close_without_position_is_rejected(self):
        path=self.write("partials.csv",[{
            "utc":"2025-10-01T00:30:00Z","trade_id":"trade_1",
            "strategy":"V4","symbol":"BTCUSDT",
            "closed_fraction_of_current":"0.5","remaining_gross_x":"0.5"
        }])
        with self.assertRaisesRegex(ValueError,"outside active position"):
            convert(Source(self.equity(),self.fills(),None,partial_events=path),
                    dict(total=3.5,crypto=3,stock=1.5))
    def test_bad_gross_is_rejected(self):
        with self.assertRaisesRegex(ValueError,"Gross"):
            convert(Source(self.equity(bad_gross=True),self.fills(),None),dict(total=3.5,crypto=3,stock=1.5))
    def canonical_position_rows(self):
        cols=["utc","trade_id","logic","symbol","side","quantity","entry_price","mark_price",
              "fx_jpy_per_price_unit","contract_multiplier","notional_jpy",
              "current_gross_x","entry_gross_x","category"]
        def empty(t):
            return dict.fromkeys(cols,"")|{"utc":t}
        return [
            empty("2025-10-01T00:00:00Z"),
            dict(utc="2025-10-01T01:00:00Z",trade_id="trade_1",logic="V4",
                 symbol="BTCUSDT",side="LONG",quantity="0.1007",
                 entry_price="100000",mark_price="100000",
                 fx_jpy_per_price_unit="1",contract_multiplier="1",
                 notional_jpy="10070",current_gross_x="1",entry_gross_x="1",
                 category="crypto"),
            empty("2025-10-01T02:00:00Z")
        ]
    def test_optional_source_snapshots_fill_quantity_mark_and_gross_only_from_exact_engine(self):
        p=self.write("POSITION_SNAPSHOTS.csv",self.canonical_position_rows())
        out=convert(Source(self.equity(),self.fills(),None,position_snapshots=p),
                    dict(total=3.5,crypto=3,stock=1.5))
        position=out["frames"][1]["positions"][0]
        self.assertEqual(position["quantity"],0.1007)
        self.assertEqual(position["mark"],100000)
        self.assertEqual(position["gross"],1)
        self.assertEqual(position["notional"],10070)
        self.assertEqual(out["frames"][0]["positions"],[])
        self.assertEqual(out["frames"][-1]["positions"],[])
        self.assertEqual(out["source"]["positionExposureEvidence"],"SOURCE_ENGINE_TIMEPOINT_RECONCILED")
        self.assertEqual(len(out["source"]["positionSnapshotsSha256"]),64)
    def test_cli_position_snapshot_import_carries_source_hash_to_export(self):
        position_path=self.write("POSITION_SNAPSHOTS.csv",self.canonical_position_rows())
        equity=self.equity()
        fills=self.fills()
        output=self.root/"cli-verified-replay.json"
        script=Path(__file__).resolve().parents[1]/"scripts"/"bt_hp_research_replay_adapter.py"
        cmd=[sys.executable,str(script),"--equity",str(equity),"--fills",str(fills),
             "--position-snapshots",str(position_path),"--total-cap","3.5",
             "--crypto-cap","3","--stock-cap","1.5","--output",str(output),
             "--interval-minutes","5"]
        run=subprocess.run(cmd,capture_output=True,text=True,encoding="utf8",check=False,timeout=15)
        self.assertEqual(run.returncode,0,run.stderr)
        replay=json.loads(output.read_text(encoding="utf8"))
        self.assertEqual(replay["source"]["positionExposureEvidence"],"SOURCE_ENGINE_TIMEPOINT_RECONCILED")
        self.assertEqual(replay["frames"][1]["positions"][0]["quantity"],0.1007)
        self.assertEqual(len(replay["source"]["positionSnapshotsSha256"]),64)
    def test_asof_equity_snapshot_before_same_timestamp_entry_is_respected(self):
        eq=self.write("equity-phase.csv",[
            dict(utc="2025-10-01T00:00:00Z",compounded_mtm_equity_jpy="10000",
                 wallet_cash_jpy="10000",open_count="0",crypto_gross_x="0",stock_gross_x="0",total_gross_x="0"),
            dict(utc="2025-10-01T01:00:00Z",compounded_mtm_equity_jpy="10000",
                 wallet_cash_jpy="10000",open_count="0",crypto_gross_x="0",stock_gross_x="0",total_gross_x="0"),
            dict(utc="2025-10-01T01:05:00Z",compounded_mtm_equity_jpy="10000",
                 wallet_cash_jpy="10000",open_count="1",crypto_gross_x="1",stock_gross_x="0",total_gross_x="1"),
            dict(utc="2025-10-01T02:00:00Z",compounded_mtm_equity_jpy="10150",
                 wallet_cash_jpy="10150",open_count="0",crypto_gross_x="0",stock_gross_x="0",total_gross_x="0")
        ])
        cols=list(self.canonical_position_rows()[0].keys())
        empty=lambda t:dict.fromkeys(cols,"")|{"utc":t}
        row=self.canonical_position_rows()[1].copy()
        row.update(utc="2025-10-01T01:05:00Z",quantity="0.1",notional_jpy="10000")
        snaps=self.write("position-phase.csv",[
            empty("2025-10-01T00:00:00Z"),empty("2025-10-01T01:00:00Z"),
            row,empty("2025-10-01T02:00:00Z")])
        out=convert(Source(eq,self.fills(),None,position_snapshots=snaps),
                    dict(total=3.5,crypto=3,stock=1.5),interval_minutes=5)
        self.assertEqual(len(out["frames"]),4)
        self.assertEqual(out["frames"][1]["gross"]["totalX"],0)
        self.assertEqual(out["frames"][1]["positions"],[])
        self.assertTrue(any("ENTRY" in x for x in out["frames"][1]["events"]))
        self.assertEqual(out["frames"][2]["positions"][0]["gross"],1)
        self.assertEqual(out["frames"][3]["positions"],[])
        self.assertGreaterEqual(out["source"]["modelEventSnapshotPhaseCorrections"],1)
        # The same source before/after issue is corrected even if position
        # current marks are missing; no current Gross is invented in that case.
        legacy=convert(Source(eq,self.fills(),None),
                       dict(total=3.5,crypto=3,stock=1.5),interval_minutes=5)
        self.assertEqual(legacy["frames"][1]["positions"],[])
        self.assertIsNone(legacy["frames"][2]["positions"][0]["gross"])
    def test_source_snapshot_missing_empty_marker_fails_closed(self):
        rows=self.canonical_position_rows()
        path=self.write("snap.csv",rows[1:])
        with self.assertRaisesRegex(ValueError,"Missing source position snapshot"):
            convert(Source(self.equity(),self.fills(),None,position_snapshots=path),
                    dict(total=3.5,crypto=3,stock=1.5))
    def test_source_snapshot_with_unknown_trade_id_fails_closed(self):
        rows=self.canonical_position_rows()
        rows[1]["trade_id"]="tampered_trade"
        path=self.write("snap.csv",rows)
        with self.assertRaisesRegex(ValueError,"portfolio/event phase mismatch"):
            convert(Source(self.equity(),self.fills(),None,position_snapshots=path),
                    dict(total=3.5,crypto=3,stock=1.5))
    def test_source_snapshot_with_wrong_crypto_gross_fails_closed(self):
        rows=self.canonical_position_rows()
        rows[1]["current_gross_x"]="0.7"
        path=self.write("snap.csv",rows)
        with self.assertRaisesRegex(ValueError,"reconciliation"):
            convert(Source(self.equity(),self.fills(),None,position_snapshots=path),
                    dict(total=3.5,crypto=3,stock=1.5))
    def test_source_snapshot_notional_quantity_price_fx_must_match(self):
        rows=self.canonical_position_rows()
        rows[1]["fx_jpy_per_price_unit"]="145"
        path=self.write("snap.csv",rows)
        with self.assertRaisesRegex(ValueError,"notional mismatch"):
            convert(Source(self.equity(),self.fills(),None,position_snapshots=path),
                    dict(total=3.5,crypto=3,stock=1.5))
    def test_source_snapshot_duplicate_id_rejected(self):
        rows=self.canonical_position_rows()
        rows.insert(2,rows[1].copy())
        path=self.write("snap.csv",rows)
        with self.assertRaisesRegex(ValueError,"Duplicate"):
            convert(Source(self.equity(),self.fills(),None,position_snapshots=path),
                    dict(total=3.5,crypto=3,stock=1.5))
    def test_source_manifest_terminal_open_model_kept_separate_from_completed_fills(self):
        rows=[
            dict(utc="2025-10-01T00:00:00Z",compounded_mtm_equity_jpy="10000",
                 wallet_cash_jpy="10000",open_count="0",crypto_gross_x="0",stock_gross_x="0",total_gross_x="0"),
            dict(utc="2025-10-01T01:00:00Z",compounded_mtm_equity_jpy="10000",
                 wallet_cash_jpy="10000",open_count="1",crypto_gross_x="1",stock_gross_x="0",total_gross_x="1"),
            dict(utc="2025-10-01T02:00:00Z",compounded_mtm_equity_jpy="10150",
                 wallet_cash_jpy="10150",open_count="1",crypto_gross_x="1",stock_gross_x="0",total_gross_x="1"),
            dict(utc="2025-10-01T03:00:00Z",compounded_mtm_equity_jpy="10150",
                 wallet_cash_jpy="10150",open_count="1",crypto_gross_x="1",stock_gross_x="0",total_gross_x="1")
        ]
        eq=self.write("terminal-equity.csv",rows)
        summary=self.root/"terminal-RUN_MANIFEST.json"
        summary.write_text(json.dumps({"status":"RESEARCH_ONLY","results":[{
            "case":"TEST_ONLY","cost_bps_roundtrip":10,"total_cap":3.5,
            "crypto_cap":3,"stock_cap":1.5,"modeled_fills":1,
            "terminal_open_count":1,"terminal_open_positions":[{
                "strategy":"Q102","symbol":"SUIUSDT","side":"LONG",
                "entry_utc":"2025-10-01T01:00:00Z","entry_price":1.1156,
                "gross_x":1,"route":"Q102|SUI",
                "modeled_future_exit_utc":"2025-10-04T03:00:00Z"}]
        }]}),encoding="utf8")
        source=Source(eq,self.fills(),summary)
        caps,evidence,meta=resolve_gross_caps(source,cost_bps=10)
        out=convert(source,caps,cap_evidence=evidence,source_meta=meta)
        self.assertEqual(out["strategyCatalog"][0]["trades"],1)
        self.assertEqual(out["terminalModelPositions"][0]["symbol"],"SUIUSDT")
        self.assertEqual(out["terminalModelPositions"][0]["entryPrice"],1.1156)
        self.assertEqual(out["terminalModelPositions"][0]["entryGrossX"],1)
        self.assertEqual(out["terminalModelPositions"][0]["modeledFutureExitAt"],"2025-10-04T03:00:00Z")
        self.assertEqual(out["terminalModelPositions"][0]["evidence"],
                         "SOURCE_RESEARCH_MANIFEST_TERMINAL_OPEN_NOT_VENUE")
        self.assertEqual(out["frames"][-1]["positions"],[],
                         "Do not synthesize filled-trade position timeline for terminal-only model")
        self.assertEqual(out["frames"][-1]["sourcePositionAlignment"],"UNMATCHED")
        self.assertEqual(out["frames"][-1]["gross"]["totalX"],1)
        self.assertIsNone(out["source"]["positionSnapshotsSha256"])
        record=json.loads(summary.read_text(encoding="utf8"))
        record["results"][0]["terminal_open_count"]=2
        summary.write_text(json.dumps(record),encoding="utf8")
        with self.assertRaisesRegex(ValueError,"terminal open positions/count mismatch"):
            resolve_gross_caps(Source(eq,self.fills(),summary),cost_bps=10)
    def test_source_snapshot_future_timestamp_rejected(self):
        rows=self.canonical_position_rows()
        rows.append(dict.fromkeys(rows[0],"")|{"utc":"2025-10-01T03:00:00Z"})
        path=self.write("snap.csv",rows)
        with self.assertRaisesRegex(ValueError,"Unexpected source position snapshot"):
            convert(Source(self.equity(),self.fills(),None,position_snapshots=path),
                    dict(total=3.5,crypto=3,stock=1.5))
    def test_snapshot_absent_preserves_null_current_gross(self):
        out=convert(Source(self.equity(),self.fills(),None),
                    dict(total=3.5,crypto=3,stock=1.5))
        self.assertEqual(out["source"]["positionExposureEvidence"],"MISSING_SOURCE_POSITION_MARKS")
        self.assertIsNone(out["frames"][1]["positions"][0]["gross"])
    def test_duplicate_trade_id_is_rejected(self):
        p=self.fills()
        with p.open(encoding="utf-8") as fh:
            rows=list(csv.DictReader(fh))
        self.write("fills.csv",rows+rows)
        with self.assertRaisesRegex(ValueError,"Duplicate"):
            convert(Source(self.equity(),p,None),dict(total=3.5,crypto=3,stock=1.5))

if __name__=="__main__":
    unittest.main()
