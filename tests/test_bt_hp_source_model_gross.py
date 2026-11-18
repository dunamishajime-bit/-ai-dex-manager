"""Synthetic model Gross source tests. No LIVE calls or fabricated quantities."""
import csv
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_research_replay_adapter import Source,convert

class ModelGrossAuditTests(unittest.TestCase):
    def setUp(self):
        t=tempfile.TemporaryDirectory()
        self.addCleanup(t.cleanup)
        self.root=Path(t.name)
        self.times=["2025-10-01T00:00:00Z","2025-10-01T01:00:00Z",
                    "2025-10-01T01:05:00Z","2025-10-01T02:00:00Z"]
        self.eqrows=[
            dict(utc=t,compounded_mtm_equity_jpy=eq,wallet_cash_jpy=cash,
                 open_count=int(i==2),total_gross_x=int(i==2),
                 crypto_gross_x=int(i==2),stock_gross_x=0)
            for i,(t,eq,cash) in enumerate(zip(self.times,
                (10000,10000,10000,10100),(10000,10000,10000,10100)))
        ]
        self.entryrow=dict(trade_id="id1",utc=self.times[1],logic="V4",
            symbol="BTCUSDT",side="LONG",route="TEST",entry_price="100",
            entry_gross_x="1",source_signal_id="s1",source_runtime_sha="0"*40)
        self.fillrow=dict(trade_id="id1",strategy="V4",symbol="BTCUSDT",
            side="LONG",entry_utc=self.times[1],exit_utc=self.times[-1],
            model_entry_price="100",net_pnl_jpy="100",notional_jpy="10000",gross_x="1")
        self.grossrow=dict(utc=self.times[2],trade_id="id1",logic="V4",
            symbol="BTCUSDT",side="LONG",entry_price="100",mark_price="100",
            current_notional_jpy="10000",current_gross_x="1",entry_gross_x="1",
            category="crypto",account_equity_jpy="10000")
        self.grosscols=list(self.grossrow)
    def write(self,name,rows,cols=None):
        path=self.root/name
        with path.open("w",newline="",encoding="utf8") as fh:
            writer=csv.DictWriter(fh,fieldnames=cols or list(rows[0]))
            writer.writeheader()
            for row in rows:writer.writerow(row)
        return path
    def src(self,*,snap=None,entries=None,eq=None,fill=None):
        return Source(
            equity=self.write("equity.csv",eq or self.eqrows),
            fills=self.write("fills.csv",fill or [self.fillrow]),
            summary=None,
            model_gross_snapshots=self.write("gross.csv",snap or self.grossrows(),self.grosscols),
            model_entries=self.write("entries.csv",entries or [self.entryrow])
        )
    def grossrows(self):
        return [dict.fromkeys(self.grosscols,"")|{"utc":self.times[0]},
                dict.fromkeys(self.grosscols,"")|{"utc":self.times[1]},
                self.grossrow,
                dict.fromkeys(self.grosscols,"")|{"utc":self.times[3]}]
    def convert(self,**kwargs):
        return convert(self.src(**kwargs),dict(total=3.5,crypto=3,stock=1.5),interval_minutes=5)
    def test_exact_model_gross_imported_without_fake_qty_fx(self):
        data=self.convert()
        assert len(data["frames"])==4
        mid=data["frames"][2]["positions"][0]
        self.assertEqual(mid["gross"],1)
        self.assertEqual(mid["mark"],100)
        self.assertEqual(mid["category"],"crypto")
        self.assertIsNone(mid["quantity"])
        self.assertEqual(data["source"]["positionExposureEvidence"],"SOURCE_MODEL_GROSS_ONLY_NO_QUANTITY_FX")
        self.assertEqual(len(data["source"]["positionGrossSnapshotsSha256"]),64)
        self.assertEqual(len(data["source"]["modelEntriesSha256"]),64)
        self.assertEqual(data["frames"][1]["positions"],[])
        self.assertEqual(data["frames"][3]["positions"],[])
    def test_missing_flat_timepoint_fails_closed(self):
        with self.assertRaisesRegex(ValueError,"Missing/repeated source Gross timepoint"):
            self.convert(snap=self.grossrows()[1:])
    def test_gross_change_without_notional_change_fails_closed(self):
        rows=self.grossrows()
        rows[2]={**rows[2],"current_gross_x":"0.77"}
        with self.assertRaisesRegex(ValueError,"notional/equity mismatch"):
            self.convert(snap=rows)
    def test_wrong_trade_id_is_not_guessed(self):
        rows=self.grossrows()
        rows[2]={**rows[2],"trade_id":"fake_trade"}
        with self.assertRaisesRegex(ValueError,"inventory"):
            self.convert(snap=rows)
    def test_duplicate_position_is_rejected(self):
        rows=self.grossrows()
        rows.insert(3,dict(rows[2]))
        with self.assertRaisesRegex(ValueError,"Duplicate"):
            self.convert(snap=rows)
    def test_equity_category_gross_mismatch_is_rejected(self):
        eq=list(self.eqrows)
        eq[2]={**eq[2],"stock_gross_x":"0.1","crypto_gross_x":"0.9"}
        with self.assertRaisesRegex(ValueError,"Gross/equity reconciliation"):
            self.convert(eq=eq)
    def test_same_timestamp_post_snapshot_preemption_keeps_source_holding(self):
        # In the engine an admitted V4 can preempt a HYPE model position
        # AFTER the equity/Gross sample at that exact timestamp. The
        # source-sampled holding still exists even though fill.exit_utc=t.
        fill=[{**self.fillrow,"exit_utc":self.times[2]}]
        out=self.convert(fill=fill)
        self.assertEqual(out["frames"][2]["positions"][0]["id"],"id1")
        self.assertEqual(out["frames"][-1]["positions"],[])
        self.assertEqual(out["frames"][2]["positions"][0]["gross"],1)

    def test_flat_marker_with_populated_position_rejected(self):
        rows=self.grossrows()
        rows.insert(2,dict.fromkeys(self.grosscols,"")|{"utc":self.times[2]})
        with self.assertRaisesRegex(ValueError,"[Ff]lat marker|mixed"):
            self.convert(snap=rows)

if __name__=="__main__":unittest.main()
