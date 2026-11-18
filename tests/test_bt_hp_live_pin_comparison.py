"""Fail-closed, offline active systemd SHA comparison tests (no SSH calls)."""
import csv,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_live_pin_comparison import SERVICE_PREFIX,compare,parse_active_services

class PinComparisonTests(unittest.TestCase):
 def setUp(self):
  td=tempfile.TemporaryDirectory();self.addCleanup(td.cleanup);self.root=Path(td.name)
  self.shas={logic:(format(i+1,"x")*40) for i,logic in enumerate(SERVICE_PREFIX)}
  self.entries=[self.save_entries("10"),self.save_entries("30")]
  self.snapshot=self.save_snapshot()
 def save_entries(self,cost,mutator=None):
  p=self.root/("CASE_"+cost+"_MODEL_ENTRIES.csv")
  rows=[dict(trade_id=cost+logic,logic=logic,source_runtime_sha=sha,entry_price="1.0")
        for logic,sha in self.shas.items()]
  if mutator:rows=mutator(rows)
  with p.open("w",encoding="utf8",newline="") as fh:
   w=csv.DictWriter(fh,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
  return p
 def save_snapshot(self,override=None):
  active=dict(self.shas)
  if override:active.update(override)
  lines=[]
  for logic,sha in active.items():
   if sha is None:continue
   if isinstance(sha,list):
    for x in sha:lines.append(SERVICE_PREFIX[logic]+"@"+x+".service loaded active running test")
   else:lines.append(SERVICE_PREFIX[logic]+"@"+sha+".service loaded active running test")
  lines.extend(["disdex-v12-v4@"+self.shas["V4"]+".service loaded inactive dead old",
                "disdex-v4-rate-budget-broker@"+self.shas["V4"]+".service loaded active running unrelated",
                "disdex-hype-long@"+self.shas["HYPE"]+".service masked failed failed old"])
  p=self.root/"systemd.txt";p.write_text("\n".join(lines)+"\n",encoding="utf8")
  return p
 def test_all_sha_same_is_not_called_full_parity(self):
  out=compare(self.snapshot,self.entries)
  self.assertEqual(out["overall"],"SHA_MATCH_ONLY_ECONOMIC_PARITY_UNVERIFIED")
  self.assertEqual(len(out["logic"]),7)
  self.assertTrue(all(x["status"]=="PIN_SHA_MATCH_ONLY" for x in out["logic"].values()))
  self.assertFalse(out["productionChanged"])
 def test_active_v4_sha_change_blocks(self):
  p=self.save_snapshot({"V4":"f"*40})
  out=compare(p,self.entries)
  self.assertEqual(out["logic"]["V4"]["status"],"PIN_MISMATCH")
  self.assertEqual(out["overall"],"BLOCKED_FULL_LIVE_PARITY")
 def test_multiple_active_runner_units_block(self):
  p=self.save_snapshot({"HYPE":[self.shas["HYPE"],"f"*40]})
  self.assertEqual(compare(p,self.entries)["logic"]["HYPE"]["status"],"MULTIPLE_ACTIVE_SERVICE_PINS")
 def test_missing_active_service_blocks(self):
  p=self.save_snapshot({"FET":None})
  self.assertEqual(compare(p,self.entries)["logic"]["FET"]["status"],"NO_RUNNING_SERVICE")
 def test_inconsistent_10bps_30bps_sources_block(self):
  second=self.save_entries("30",lambda rows:[{**r,"source_runtime_sha":"f"*40} if r["logic"]=="Q102" else r for r in rows])
  self.assertEqual(compare(self.snapshot,[self.entries[0],second])["logic"]["Q102"]["status"],"MULTIPLE_SOURCE_PINS")
 def test_duplicate_admission_fails(self):
  def dup(rows):return rows+[rows[0].copy()]
  bad=self.save_entries("30",dup)
  with self.assertRaisesRegex(ValueError,"Duplicate"):compare(self.snapshot,[bad])
 def test_wrong_sha_fails_closed(self):
  bad=self.save_entries("30",lambda rows:[{**r,"source_runtime_sha":"unknown"} if r["logic"]=="V52" else r for r in rows])
  with self.assertRaisesRegex(ValueError,"Invalid model-runtime SHA"):compare(self.snapshot,[bad])
 def test_dont_treat_only_partial_runner_as_active(self):
  rows=self.snapshot.read_text("utf8")
  rows=rows.replace("disdex-v12-v4@"+self.shas["V4"]+".service loaded active running test",
                    "disdex-v12-v4@"+self.shas["V4"]+".service loaded active exited test")
  self.snapshot.write_text(rows,encoding="utf8")
  self.assertEqual(compare(self.snapshot,self.entries)["logic"]["V4"]["status"],"NO_RUNNING_SERVICE")

if __name__=="__main__":unittest.main()