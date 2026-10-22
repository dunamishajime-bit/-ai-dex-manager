#!/usr/bin/env python3
"""Verify V52 native fixed-tape counterfactual provenance and H1 guardrails."""
import importlib.util,collections,hashlib,json,tempfile,unittest
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("v52_true_stock_research_tests",
 HERE/"run-v52-correct-stock-tape-full8-after-fet-20261022.py")
assert spec and spec.loader
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class TapeTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  m.m.acquire_verified_h1()
  cls.origin=m.m.jsonl(m.STOCK_ARCHIVE/"v52-model-ledger.jsonl")
  assert len(cls.origin)==99
  cls.tapes={}
  for name in m.CASES:
   root,manifest=m.build_stock_tape(name)
   cls.tapes[name]=(m.m.jsonl(root/"v52-model-ledger.jsonl"),manifest,root)
 def test_sha_pinned_archived_original(self):
  self.assertEqual(m.hashfile(m.STOCK_ARCHIVE/"v52-model-ledger.jsonl"),
   "7bce3e7cd7363625d17d9a8d0d3bf10130699586e9fb1e184bc1cc51e1b85b6f")
 def test_baseline_rowwise_identity(self):
  rows,manifest,_=self.tapes[m.BASE]
  self.assertEqual(rows,self.origin)
  self.assertEqual(manifest["modifiedClosedRows"],0)
 def test_all_cases_preserve_stock_symbol_side_and_start(self):
  for name,(rows,manifest,_) in self.tapes.items():
   self.assertEqual(len(rows),99)
   for orig,after in zip(self.origin,rows):
    for key in ("entry_ts_ms","aster_entry_price_usd","side","symbol","slot_gross","status","entry_basis_bps","yahoo_entry_reference_usd","historical_fill_verified"):
     self.assertEqual(orig.get(key),after.get(key),(name,key))
 def test_suppressed11_unchanged(self):
  suppressed=[i for i,row in enumerate(self.origin) if row["status"]!="MODELED_CLOSED_TRADE"]
  self.assertEqual(len(suppressed),11)
  for name,(rows,manifest,_) in self.tapes.items():
   self.assertEqual(manifest["suppressedPreentryUnmodified"],11)
   for i in suppressed:self.assertEqual(rows[i],self.origin[i],(name,i))
 def test_only_allowed_exit_fields_changed(self):
  changed_fields={"exit_ts_ms","aster_exit_price_usd","gross_price_return","reason"}
  for name,(rows,manifest,_) in self.tapes.items():
   changed=0
   for orig,new in zip(self.origin,rows):
    fields={key for key in orig if orig[key]!=new[key]}
    self.assertTrue(fields<=changed_fields,(name,fields))
    if fields:
     self.assertEqual(new["status"],"MODELED_CLOSED_TRADE")
     self.assertLess(orig["entry_ts_ms"],new["exit_ts_ms"])
     self.assertLess(new["exit_ts_ms"],orig["exit_ts_ms"])
     sign=1 if new["side"]=="LONG" else -1
     expected=sign*(new["aster_exit_price_usd"]/new["aster_entry_price_usd"]-1)
     self.assertAlmostEqual(expected,new["gross_price_return"],places=11)
     changed+=1
   self.assertEqual(changed,manifest["modifiedClosedRows"])
 def test_long_short_separate_in_native_tape(self):
  for name,(rows,manifest,_) in self.tapes.items():
   if name==m.BASE:continue
   self.assertGreater(manifest["modifiedClosedRows"],0)
   desired="LONG" if "LONG_" in name else "SHORT"
   for x in manifest["events"]:
    self.assertEqual(x["side"],desired)
    self.assertTrue(x["newReason"].startswith("RESEARCH_H1_V52"))
 def test_model_summary_explicitly_research_only(self):
  for name,(_,manifest,root) in self.tapes.items():
   summary=json.loads((root/"v52-model-summary.json").read_text("utf-8"))
   self.assertEqual(summary["model"],"V52_20261022_COUNTERFACTUAL_HOURLY_RESEARCH_TAPE")
   self.assertTrue(any("11 suppressed" in s for s in summary["limitations"]))
   self.assertFalse(summary["audited_live_execution_parity"])
 def test_interception_does_not_touch_other_files(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);path=root/"run-current-vps-no-dca.py"
   path.write_text(m.STOCK_LOOKUP_LITERAL,encoding="utf-8")
   prev=m.ACTIVE_TAPE_ROOT
   try:
    m.ACTIVE_TAPE_ROOT=self.tapes[m.BASE][2]
    new=m.research_stock_root_path_read(path)
    self.assertIn("pathlib.Path(",new)
    self.assertNotIn(m.STOCK_LOOKUP_LITERAL,new)
    other=root/"other.py";other.write_text("safe other content",encoding="utf-8")
    self.assertEqual(m.research_stock_root_path_read(other),"safe other content")
    self.assertEqual(path.read_text("utf-8"),m.STOCK_LOOKUP_LITERAL)
   finally:
    m.ACTIVE_TAPE_ROOT=prev

if __name__=="__main__":unittest.main()
