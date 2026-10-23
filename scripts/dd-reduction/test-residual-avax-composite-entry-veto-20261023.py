#!/usr/bin/env python3
"""Research-only causal consistency tests for AVAX RESIDUAL entry gates."""
from __future__ import annotations
import importlib.util,json,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
PANEL=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8/rv23loss/AVAX_COMPOSITE_LOSS_ENTRY_PANEL_20261023.json")
FULL=ROOT/"docs/research/results/residual-composite-20261023/AVAX_COMPOSITE_ENTRY_VETO_NATIVE_FULL8_20261023.json"
p=importlib.util.spec_from_file_location("avax_entry_gates_unit",HERE/"research-residual-avax-composite-entry-veto-full8-20261023.py")
mod=importlib.util.module_from_spec(p);p.loader.exec_module(mod)
class TestAvaxEntryGates(unittest.TestCase):
 def test_rule_names(self):
  self.assertIn("BASE_COMPOSITE",mod.CASES)
  self.assertIn("VETO_CO_DECLINE",mod.CASES)
  self.assertIn("VETO_DUAL",mod.CASES)
  self.assertIn("VETO_TRIPLE",mod.CASES)
 def test_specific_conditions(self):
  avax={"ret1h":0,"ret3h":-.8,"ret6h":-.7}
  btc={"ret1h":0,"ret3h":-.1,"ret6h":-.2}
  self.assertEqual(mod.reason("CO_DECLINE",avax,btc),"co_decline")
  self.assertEqual(mod.reason("DUAL",avax,btc),"co_decline")
  self.assertEqual(mod.reason("TRIPLE",avax,btc),"co_decline")
  self.assertIsNone(mod.reason("AVAX_RALLY_BTC_WEAK",avax,btc))
  avax={"ret1h":.4,"ret3h":.9,"ret6h":4.}
  self.assertEqual(mod.reason("AVAX_RALLY_BTC_WEAK",avax,btc),"divergent_rally")
  self.assertEqual(mod.reason("DUAL",avax,btc),"divergent_rally")
  btc["ret6h"]=1.
  self.assertIsNone(mod.reason("DUAL",avax,btc))
 def test_panel_early_and_later_costs(self):
  z=json.loads(PANEL.read_text("utf8"))["costs"]
  for cost in ("10","30"):
   rows=z[cost]
   self.assertEqual(len(rows),24)
   for rule,expected in (("CO_DECLINE",4),("AVAX_RALLY_BTC_WEAK",3),("DUAL",7),("TRIPLE",8)):
    veto=[]
    for r in rows:
     f=r["features"]
     aa={"ret1h":f["avaxret1h"],"ret3h":f["avaxret3h"],"ret6h":f["avaxret6h"]}
     bb={"ret1h":f["btcret1h"],"ret3h":f["btcret3h"],"ret6h":f["btcret6h"]}
     if mod.reason(rule,aa,bb):veto.append(r)
    self.assertEqual(len(veto),expected)
    self.assertEqual(sum(r["win"] for r in veto),0)
    self.assertGreaterEqual(sum(r["entryUtc"][:4]>"2025" for r in veto),1)
 def test_no_future_in_gate_source(self):
  s=(HERE/"research-residual-avax-composite-entry-veto-full8-20261023.py").read_text("utf8")
  self.assertIn("bars[j-1][4]",s)
  self.assertIn("bars[j-1-12*h][4]",s)
  self.assertIn("original_filter(rows,overlays,source,cost_bps,obs,baseline_lookup)",s)
  self.assertIn('row.get("strategy_id")!="RESIDUAL"',s)
  self.assertIn('row.get("symbol")=="DOGEUSDT"',s)
  self.assertIn('original_screen._find_exit(row,policy',s)
  self.assertIn("native.replay(",s)
if __name__=="__main__":unittest.main()
