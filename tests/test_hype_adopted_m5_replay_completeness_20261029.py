"""Source-only HYPE75 snapshot replay evidence must never manufacture MFE history."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
CLI=ROOT/"scripts/research/replay-hype-adopted-m5-readonly-20261029.ts"
TSX=ROOT/"node_modules/.bin/tsx"
M5=300000
T=(1793000000000//M5)*M5

def bars(last):
    result=[]
    for i in range(37):
        price=last if i==36 else 100
        result.append({"openTime":T+i*M5, "open":price,"high":price*1.001,
                       "low":price*0.999,"close":price})
    return result

def replay(case):
    doc={"decisionTs":T+37*M5,
         "btcM5":bars(100.5),"hypeM5":bars(103.2),
         "ownedPosition":{"entryTs":T+10*M5,"entryPrice":100}}
    case(doc)
    with tempfile.TemporaryDirectory() as d:
        filename=Path(d)/"snapshot.json"
        filename.write_text(json.dumps(doc),encoding="utf8")
        return subprocess.run([str(TSX),str(CLI),str(filename)],
             cwd=ROOT,capture_output=True,text=True,timeout=35)

class ReplayHistoryProof(unittest.TestCase):
    def test_contiguous_entry_to_latest_m5_is_accepted_source_only(self):
        p=replay(lambda d:None)
        self.assertEqual(p.returncode,0,p.stderr)
        j=json.loads(p.stdout)
        self.assertEqual(j["ordersSent"],0)
        self.assertEqual(j["cancelsSent"],0)
        self.assertFalse(j["liveActivationAllowed"])
        self.assertEqual(j["completedBars"],27)
    def test_missing_entry_history_rejects_before_false_no_exit(self):
        p=replay(lambda d:d.update(hypeM5=d["hypeM5"][27:]))
        self.assertNotEqual(p.returncode,0)
        self.assertIn("INCOMPLETE_M5_EXIT_REPLAY:ENTRY_HISTORY_MISSING",p.stderr)
    def test_missing_tail_rejects_before_false_no_exit(self):
        p=replay(lambda d:d.update(hypeM5=d["hypeM5"][:-1]))
        self.assertNotEqual(p.returncode,0)
        self.assertIn("INCOMPLETE_M5_EXIT_REPLAY:TAIL_CANDLES_MISSING",p.stderr)

if __name__=="__main__":unittest.main()
