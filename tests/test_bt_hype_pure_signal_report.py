import json
from pathlib import Path
import unittest
from datetime import datetime,timezone

ROOT=Path(__file__).resolve().parents[1]
REPORT=ROOT/"docs/research-results/BT_HYPE_PINNED_PURE_SIGNAL_REPLAY_20261119_UNCERTIFIED.json"
VPS=ROOT/"docs/research-results/BT_VPS_ENTRYPOINT_PARITY_20261119_UNCERTIFIED.json"
RECONCILED=ROOT/"docs/research-results/BT_HYPE_PURE_SIGNAL_MODEL_DECISION_RECONCILE_20261119_UNCERTIFIED.json"

class HypePinnedSignalEvidenceTests(unittest.TestCase):
 def setUp(self):
  self.pure=json.loads(REPORT.read_text(encoding="utf8"))
  self.pins=json.loads(VPS.read_text(encoding="utf8"))
  self.decisions=json.loads(RECONCILED.read_text(encoding="utf8"))
 def test_pinned_source_matches_observed_hype_sha(self):
  self.assertEqual(self.pure["schema"],"disdex-bt-hype-pinned-pure-signal-replay/v1")
  pinned=next(x["git_commit"] for x in self.pins["rows"] if x["runner"]=="HYPE")
  self.assertEqual(self.pure["observed_live_git_commit"],pinned)
  self.assertFalse(self.pure["runtime_active_signal_mode_verified"])
  self.assertFalse(self.pure["production_bt_parity_certified"])
  self.assertFalse(self.pure["actual_exchange_fills_verified"])
 def test_unique_causal_candidates_and_reason_counts(self):
  rows=self.pure["accepted_pure_signals"]
  times=[row["utc"] for row in rows]
  self.assertEqual(len(times),len(set(times)))
  self.assertEqual(len(rows),self.pure["accepted_pure_signal_count"])
  self.assertEqual(self.pure["six_hour_boundaries_tested"],1460)
  self.assertEqual(sum(self.pure["rejects_by_reason"].values()),1460)
  for value in times:
   dt=datetime.fromisoformat(value.replace("Z","+00:00"))
   self.assertEqual(dt.minute,0)
   self.assertEqual(dt.hour%6,0)
   self.assertGreaterEqual(dt,datetime(2025,10,1,tzinfo=timezone.utc))
   self.assertLess(dt,datetime(2026,10,1,tzinfo=timezone.utc))
 def test_research_entries_and_missing_decisions_are_not_executions(self):
  self.assertEqual(self.pure["research_modeled_hype_exits"],5)
  self.assertEqual(self.pure["modeled_research_entry_overlap"],5)
  self.assertEqual(self.pure["modeled_research_entries_not_in_pure_signal"],[])
  for bps in ("10","30"):
   row=self.decisions["scenarios"][bps]
   self.assertEqual(row["pure_signal_candidates"],35)
   self.assertEqual(row["historical_modeled_enters"],5)
   self.assertEqual(row["historical_blocks"],22)
   self.assertEqual(row["pure_signals_without_hype_decision_count"],8)
   self.assertFalse(row["cause_of_unlogged_pure_candidates_verified"])
  self.assertFalse(self.decisions["production_bt_parity_certified"])

if __name__=="__main__":
 unittest.main()
