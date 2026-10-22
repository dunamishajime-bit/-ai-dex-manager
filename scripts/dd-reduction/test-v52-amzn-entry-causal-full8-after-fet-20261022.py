#!/usr/bin/env python3
"""AMZN-specific Yahoo H1 entry veto provenance, chronology, and portfolio gates."""
from __future__ import annotations
import datetime,importlib.util,json,unittest
from pathlib import Path
from zoneinfo import ZoneInfo

HERE=Path(__file__).resolve().parent
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
p=importlib.util.spec_from_file_location("v52_amzn_causal_gate_test",HERE/"run-v52-amzn-entry-full8-after-fet-20261022.py")
assert p and p.loader
m=importlib.util.module_from_spec(p)
p.loader.exec_module(m)

class TestV52AMZNEntry(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.ref=m.get_amzn_reference()
  cls.native=m.native.m.jsonl(m.native.STOCK_ARCHIVE/"v52-model-ledger.jsonl")
  cls.amzn=[x for x in cls.native if x.get("status")=="MODELED_CLOSED_TRADE" and x.get("symbol")=="AMZNUSDT"]
  cls.out=ROOT/"v52_amzn_entry_studies_20261022"
 def test_immutable_source_original_counts(self):
  self.assertEqual(len(self.native),99)
  self.assertEqual(len(self.amzn),17)
  self.assertEqual(sum(x.get("status")!="MODELED_CLOSED_TRADE" for x in self.native),11)
 def test_research_evaluates_yahoo_completed_only(self):
  for x in self.amzn:
   f=m.feature(*self.ref,x["entry_ts_ms"])
   end=datetime.datetime.fromisoformat(f["yahooLastCompletedBarStartedUtc"]).timestamp()*1000+3600000
   self.assertLessEqual(end,int(x["entry_ts_ms"]))
   prior=datetime.datetime.fromisoformat(f["previousNySessionLastCloseBarStartedUtc"]).astimezone(
       ZoneInfo("America/New_York")).date()
   today=datetime.datetime.fromtimestamp(x["entry_ts_ms"]/1000,ZoneInfo("America/New_York")).date()
   self.assertLess(prior,today)
 def test_missing_prior_session_is_rejected(self):
  first=self.ref[0][:1]
  complete=[first[0]["start_ms"]+3600000]
  with self.assertRaises(RuntimeError):
   m.feature(first,complete,complete[0])
 def test_expected_amzn_side_breakdown_and_threshold_counts(self):
  self.assertEqual(sum(x["side"]=="LONG" for x in self.amzn),6)
  self.assertEqual(sum(x["side"]=="SHORT" for x in self.amzn),11)
  want={"AMZN_SHORT_PRIOR_CLOSE_PLUS0P0":3,
        "AMZN_SHORT_PRIOR_CLOSE_PLUS0P5":3,
        "AMZN_SHORT_PRIOR_CLOSE_PLUS1P0":1,
        "AMZN_LONG_H1_MINUS1P0":1,
        "AMZN_SHORT0P5_PLUS_LONG_H1_MINUS1P0":4}
  for name,n in want.items():
   params=m.SPECS[name]
   got=[x for x in self.amzn if m.veto(x,params,*self.ref)[0]]
   self.assertEqual(len(got),n,(name,len(got)))
 def test_gate_does_not_modify_unrelated_symbols_or_existing_skips(self):
  for name in ("AMZN_SHORT_PRIOR_CLOSE_PLUS0P5","AMZN_SHORT_PRIOR_CLOSE_PLUS1P0",
               "AMZN_LONG_H1_MINUS1P0","AMZN_SHORT0P5_PLUS_LONG_H1_MINUS1P0"):
   dst=self.out/name/"v52-model-ledger.jsonl"
   if not dst.exists():continue
   rows=m.native.m.jsonl(dst)
   self.assertEqual(len(rows),len(self.native))
   for before,after in zip(self.native,rows):
    if before.get("status")!="MODELED_CLOSED_TRADE" or before.get("symbol")!="AMZNUSDT":
     self.assertEqual(before,after)
   cnt=sum(x["status"]=="SKIPPED_CANDIDATE" for x in rows)
   self.assertEqual(cnt,11+sum(m.veto(x,m.SPECS[name],*self.ref)[0] for x in self.amzn))
 def test_side_filters_and_full8_rejection_are_only_amzn(self):
  for name,params in m.SPECS.items():
   for x in self.amzn:
    match,_=m.veto(x,params,*self.ref)
    if match:
     self.assertEqual(x["symbol"],"AMZNUSDT")
     if params[0] is None:self.assertEqual(x["side"],"LONG")
     if params[1] is None:self.assertEqual(x["side"],"SHORT")
 def test_v52_native_stops_untouched(self):
  obj=json.loads((m.REPO/"config/v52V50Runtime.json").read_text("utf-8"))
  self.assertEqual(obj["basisStopMultiple"],1.75)
  self.assertEqual(obj["convergenceBps"],20)
 def test_across_costs_rejected_amzn_rows_equal(self):
  reports=[]
  for path in (ROOT/"f8v52amzn/V52_AMZN_YAHOO_ENTRY_FULL8_20261022.json",
               ROOT/"f8v52amzn_more/V52_AMZN_YAHOO_ENTRY_FULL8_20261022.json"):
   if path.exists():reports.append(json.loads(path.read_text("utf-8")))
  for report in reports:
   self.assertEqual(report["status"],m.OUTPUT_TAG)
   self.assertFalse(report["recreatedPreviouslySuppressedV52Candidates"] if "recreatedPreviouslySuppressedV52Candidates" in report else report["recreatedPreviouslySuppressedV52Candidates"])
   for name,case in report["cases"].items():
    self.assertEqual(case["tape"]["amznOriginalClosed"],17)
    for cost,v in case["costs"].items():
     self.assertEqual(v["accounting"],"PASS")
     self.assertEqual(v["v52Trades"],87-case["tape"]["amznVetoCount"])
     self.assertEqual(v["amzn"]["new"],17-case["tape"]["amznVetoCount"])
     self.assertEqual(v["amzn"]["wins"]+v["amzn"]["losses"],v["amzn"]["new"])
if __name__=="__main__":unittest.main()
