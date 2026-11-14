"""HYPE 78 native signal times vs same-tick competing research candidates."""
import csv,copy,math,sys,tempfile,unittest
from datetime import datetime,timezone,timedelta
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_hype_layer3_competing_candidates_audit import load_decisions,reconcile

START=datetime(2025,10,1,tzinfo=timezone.utc)
TIMES=[(START+timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M:%SZ") for i in range(78)]
def shadow():
    return {"schema":"disdex-bt-hype-native-layer2-3-asof-shadow/v1",
      "models":{b:{"signals":[{"candidateEntryUtc":t} for t in TIMES]} for b in ("10bps","30bps")}}
def logs():
    x={t:[{"signalId":f"HYPE_{i+1:05d}","strategy":"HYPE",
       "decision":"BLOCK","reason":"GROSS","requestedGrossX":1.0}]
       for i,t in enumerate(TIMES)}
    x[TIMES[0]].append({"signalId":"V4_00001","strategy":"V4",
       "decision":"MODEL_ENTER","reason":"MODELED_EXIT_NOT_VENUE_FILL","requestedGrossX":.75})
    x[TIMES[5]].append({"signalId":"Q102_00001","strategy":"Q102",
       "decision":"BLOCK","reason":"SYMBOL_BUSY","requestedGrossX":1.0})
    return x
def csv_rows(path,drop=False):
    rows=[]
    for i,t in enumerate(TIMES):
        if drop and i==77:continue
        rows.append({"signal_id":f"HYPE_{i+1:05d}","strategy":"HYPE",
           "utc":t,"decision":"BLOCK","reason":"CAP","requested_gross":1.0})
    rows.append({"signal_id":"V4_00001","strategy":"V4",
       "utc":TIMES[0],"decision":"MODEL_ENTER",
       "reason":"MODELED_EXIT_NOT_VENUE_FILL","requested_gross":.75})
    with path.open("w",encoding="utf8",newline="") as f:
      w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
class HypeLayer3CandidateOverlapTests(unittest.TestCase):
 def test_competing_events_can_be_counted_but_never_ranked(self):
    x=reconcile(shadow(),logs(),logs())
    self.assertEqual(x["models"]["10bps"]["withSameTickCompetitor"],2)
    self.assertEqual(x["models"]["10bps"]["sameTickCompetitorCandidateCount"],2)
    self.assertFalse(x["competingCandidateEVAvailable"])
    self.assertTrue(x["postTickDecisionsAreNeverCausalFeatures"])
    self.assertIsNone(x["models"]["10bps"]["events"][0]["opportunityRank"])
 def test_missing_one_hype_event_fails_closed(self):
    x=logs();del x[TIMES[-1]]
    with self.assertRaisesRegex(ValueError,"TIME_COVERAGE"):
      reconcile(shadow(),x,logs())
 def test_duplicate_signal_timestamp_fails_closed(self):
    sh=shadow()
    sh["models"]["10bps"]["signals"][-1]["candidateEntryUtc"]=TIMES[0]
    with self.assertRaisesRegex(ValueError,"SIGNAL_SET_NOT_78_UNIQUE"):
      reconcile(sh,logs(),logs())
 def test_model_decision_log_exact_time_source(self):
    with tempfile.TemporaryDirectory() as d:
      f=Path(d)/"d.csv";csv_rows(f)
      x=load_decisions(f,set(TIMES))
      self.assertEqual(len(x),78)
      self.assertEqual(len(x[TIMES[0]]),2)
 def test_missing_native_hype_decision_refused(self):
    with tempfile.TemporaryDirectory() as d:
      f=Path(d)/"d.csv";csv_rows(f,drop=True)
      with self.assertRaisesRegex(ValueError,"NOT_ALL_HYPE_CANDIDATE_TIMES"):
        load_decisions(f,set(TIMES))
 def test_nonfinite_requested_model_gross_refused(self):
    with tempfile.TemporaryDirectory() as d:
      f=Path(d)/"d.csv";csv_rows(f)
      text=f.read_text("utf8").replace("CAP,1.0","CAP,nan",1)
      f.write_text(text,"utf8")
      with self.assertRaisesRegex(ValueError,"INVALID_MODEL_GROSS_REQUEST"):
        load_decisions(f,set(TIMES))
if __name__=="__main__":unittest.main()
