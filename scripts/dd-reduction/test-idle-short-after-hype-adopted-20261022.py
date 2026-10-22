#!/usr/bin/env python3
"""Protect side and symbol scope for Idle SHORT research overlays."""
import importlib.util,json,pathlib,unittest
HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("idle_short_cumulative", HERE/"run-idle-short-after-hype-adopted-20261022.py")
assert spec and spec.loader
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class IdleShortResearchGuards(unittest.TestCase):
 def test_only_render_short(self):
  rule=m.IDLE_RULES["IDLE_RENDER_INITIAL_1H_1P0_MFE0P3"]
  self.assertTrue(m.matches({"strategy_id":"IDLE","side":"SHORT","symbol":"RENDERUSDT"},rule))
  self.assertFalse(m.matches({"strategy_id":"IDLE","side":"SHORT","symbol":"TAOUSDT"},rule))
  self.assertFalse(m.matches({"strategy_id":"IDLE","side":"LONG","symbol":"RENDERUSDT"},rule))
  self.assertFalse(m.matches({"strategy_id":"HYPE_LONG","side":"LONG","symbol":"HYPEUSDT"},rule))
 def test_tao_excludes_render(self):
  rule=m.IDLE_RULES["IDLE_TAO_INITIAL_1H_1P0_MFE0P3"]
  self.assertTrue(m.matches({"strategy_id":"IDLE","side":"SHORT","symbol":"TAOUSDT"},rule))
  self.assertFalse(m.matches({"strategy_id":"IDLE","side":"SHORT","symbol":"RENDERUSDT"},rule))
 def test_hype_rule_unchanged(self):
  self.assertEqual(m.HYPE_RULE["stop_pct"],.01)
  self.assertEqual(m.HYPE_RULE["arm_hours"],1)
  self.assertEqual(m.HYPE_RULE["mfe_gate_pct"],.003)
  self.assertEqual(m.HYPE_RULE["arm"],.03)
  self.assertEqual(m.HYPE_RULE["floor"],.015)
 def test_config_adopted(self):
  cfg=json.loads(m.CONFIG.read_text(encoding="utf-8"))
  self.assertEqual(cfg["adoptedCombinedCaseId"],"COMBO_I1H1_P3F1P5")
  self.assertIn("10",cfg["adoptedDualExitIntegratedAnchor"])
  self.assertIn("30",cfg["adoptedDualExitIntegratedAnchor"])
if __name__=="__main__":unittest.main()
