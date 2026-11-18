"""Synthetic source/decision/terminal-open checks for Q102 HIGH_VOL 19 events."""
import copy,csv,json,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_q102_highvol_source_admission_audit import (
    source_candidates,audit_case,SOURCE_SHA,START,END,
)
def fixture(root):
    symbols=["ARBUSDT"]*2+["ONDOUSDT"]*10+["SUIUSDT"]*7
    native=[]
    for i in range(224):
        row={"id":"OTHER_"+str(i),"route":"MR72_Z1.5","symbol":"FETUSDT"}
        if i<19:
          symbol=symbols[i];ts=START+(i+1)*3600000
          if i==18:ts=END-3600000
          row={"id":f"Q102HV_{i+1:05d}","strategy":"Q102_CAUSAL_V4",
               "sourceRuntimeSha":SOURCE_SHA,"symbol":symbol,
               "side":"SHORT","family":"HIGH_VOL","layer":"S1",
               "route":"HIGH_VOL|"+symbol,
               "entryTs":ts,"entryPrice":100.,"exitTs":ts+2*3600000,
               "exitPrice":102.,"requestedGross":0.6,
               "productionV4SourceSignalId":f"HIGH_VOL:{symbol}:{ts-3600000}"}
        native.append(row)
    src=root/"src.jsonl";src.write_text("\n".join(json.dumps(x) for x in native)+"\n")
    candidates=source_candidates(src)
    assert len(candidates)==19
    admitted={"Q102P_00001","Q102P_00002","Q102P_00019"}
    decision_rows=[];entry_rows=[];fills_rows=[]
    for k,x in candidates.items():
        t=__import__("datetime").datetime.fromtimestamp(x["entryTs"]/1000,__import__("datetime").timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        accept=k in admitted
        decision_rows.append({"signal_id":k,"strategy":"Q102","utc":t,
                              "decision":"MODEL_ENTER" if accept else "BLOCK",
                              "reason":"MODELED_EXIT_NOT_VENUE_FILL" if accept else "SYMBOL_BUSY",
                              "requested_gross":0.6})
        if accept:
            entry_rows.append({"logic":"Q102","route":x["route"],"symbol":x["symbol"],
                  "side":x["side"],"utc":t,"source_runtime_sha":SOURCE_SHA,
                  "source_signal_id":k,"entry_gross_x":0.6})
            if k!="Q102P_00019":
              fills_rows.append({"strategy":"Q102","route":x["route"],"symbol":x["symbol"],
                   "side":x["side"],"source_signal_id":k,"net_pnl_jpy":-50.,
                   "exit_utc":t,"exit_model_reason":"Q102_PROD_TIME",
                   "model_entry_price":100.,"model_exit_price":102.,
                   "actual_venue_order_id":"","actual_filled_quantity":"",
                   "signed_execution_verified":"False"})
    def write(filename,rows):
      p=root/filename
      with p.open("w",encoding="utf8",newline="") as f:
        w=csv.DictWriter(f,fieldnames=rows[0]);w.writeheader();w.writerows(rows)
      return p
    return candidates,write("decisions.csv",decision_rows),write("entries.csv",entry_rows),write("fills.csv",fills_rows),src
class HighVolSourceDecisionTests(unittest.TestCase):
 def test_reconcile_all_19_with_period_end_open(self):
    with tempfile.TemporaryDirectory() as d:
      c,p,e,f,_=fixture(Path(d))
      x=audit_case(c,p,e,f,10)
      self.assertEqual(x["nativeCandidates"],19)
      self.assertEqual(x["modeledAdmissions"],3)
      self.assertEqual(x["modeledClosed"],2)
      self.assertEqual(x["openAtModelPeriodEnd"],1)
      self.assertEqual(x["modeledBlocked"],16)
 def test_duplicate_source_signal_rejected(self):
    with tempfile.TemporaryDirectory() as d:
      c,p,e,f,src=fixture(Path(d))
      rows=[json.loads(line) for line in src.read_text().splitlines()]
      rows[1]["productionV4SourceSignalId"]=rows[0]["productionV4SourceSignalId"]
      src.write_text("\n".join(json.dumps(x) for x in rows))
      with self.assertRaisesRegex(ValueError,"DUPLICATE_SOURCE_SIGNAL"):
        source_candidates(src)
 def test_source_sha_mismatch_rejected(self):
    with tempfile.TemporaryDirectory() as d:
      _,p,e,f,src=fixture(Path(d))
      rows=[json.loads(line) for line in src.read_text().splitlines()]
      rows[0]["sourceRuntimeSha"]="bad"
      src.write_text("\n".join(json.dumps(x) for x in rows))
      with self.assertRaisesRegex(ValueError,"PINNED_NATIVE_IDENTITY_DRIFT"):
        source_candidates(src)
 def test_missing_one_source_decision_rejected(self):
    with tempfile.TemporaryDirectory() as d:
      c,p,e,f,_=fixture(Path(d))
      with p.open("r",encoding="utf8",newline="") as h:
       rows=list(csv.DictReader(h))
      rows=rows[:-1]
      with p.open("w",encoding="utf8",newline="") as h:
       w=csv.DictWriter(h,fieldnames=rows[0]);w.writeheader();w.writerows(rows)
      with self.assertRaisesRegex(ValueError,"MISSING_SOURCE_HIGH_VOL_DECISIONS"):
        audit_case(c,p,e,f,10)
 def test_false_venue_fill_provenance_rejected(self):
    with tempfile.TemporaryDirectory() as d:
      c,p,e,f,_=fixture(Path(d))
      with f.open("r",encoding="utf8",newline="") as h:rows=list(csv.DictReader(h))
      rows[0]["actual_venue_order_id"]="fake"
      with f.open("w",encoding="utf8",newline="") as h:
       w=csv.DictWriter(h,fieldnames=rows[0]);w.writeheader();w.writerows(rows)
      with self.assertRaisesRegex(ValueError,"PRETENDS_VENUE_FILL"):
        audit_case(c,p,e,f,30)
 def test_closed_model_fill_missing_cannot_be_assumed_open(self):
    with tempfile.TemporaryDirectory() as d:
      c,p,e,f,_=fixture(Path(d))
      with f.open("r",encoding="utf8",newline="") as h:rows=list(csv.DictReader(h))
      rows=rows[:1]
      with f.open("w",encoding="utf8",newline="") as h:
       w=csv.DictWriter(h,fieldnames=rows[0]);w.writeheader();w.writerows(rows)
      with self.assertRaisesRegex(ValueError,"CLOSED_OR_VERIFIED_OPEN"):
        audit_case(c,p,e,f,10)
if __name__=="__main__":unittest.main()
