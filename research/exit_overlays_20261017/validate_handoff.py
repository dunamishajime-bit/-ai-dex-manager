"""Static verifications for this research-only Codex handoff. Not a full backtest or venue certification."""
from pathlib import Path
import json,math,hashlib,ast
ROOT=Path(__file__).resolve().parent
E=ROOT/"evidence"
load=lambda name:json.loads((E/name).read_text("utf8"))
j=load("RESEARCH_HANDOFF_MANIFEST.json")
p={v["id"]:v for v in load("SELECTED_POLICY_PROFILES.json")}
assert j["status"]=="RESEARCH_VERIFIED_IMPLEMENTATION_CANDIDATE_NOT_LIVE"
assert len(load("bt120_predeclared_profiles.json"))==120
assert p["Q102_06_FLOOR_2_TO_0p5"]["arm"]==.02
assert p["Q102_06_FLOOR_2_TO_0p5"]["floor"]==.005
assert p["HYPE_LONG_01_HARD_WALLET_2"]["risk"]==.02
assert p["IDLE_13_TRAIL_3_GIVEBACK_1p5"]["trail_arm"]==.03
assert p["IDLE_13_TRAIL_3_GIVEBACK_1p5"]["giveback"]==.015
x=load("TRAILING_ALL_12_REPLAY_CASES.json")
assert len(x["results"])==12
for cost in (10,30):
 row=next(z for z in x["results"] if z["name"]=="DOT_RENDER_TRAIL_3" and z["cost_bps"]==cost)
 k=str(cost)+"bps"
 a=j["five_change_winner"][k]
 assert math.isclose(row["final_jpy"],a["final_jpy"],rel_tol=1e-13)
 assert row["dd_pct"]==a["dd_pct"] and row["trades"]==a["trades"]
 assert row["equity_delta"]>0 and row["dd_delta"]>0 and row["trade_delta"]>=0
 assert row["m5_exit_change_bystrategy"]["Q102"]>0
 assert row["m5_exit_change_bystrategy"]["HYPE_LONG"]>0
 assert row["m5_exit_change_bystrategy"]["IDLE"]>0
 for s in ("DOTUSDT","RENDERUSDT"):
  assert row["idle_by_symbol"][s]["max_gross"]<=.2500001
 prior=x["baseline"][str(cost)]
 assert prior["accounting"]=="PASS"
 assert row["final_jpy"]>prior["final_jpy"]
 assert row["dd_pct"]>=prior["max_dd_pct"]
 assert row["trades"]>=prior["annual_trades"]
for f in (ROOT/"scripts").glob("*.py"):
 ast.parse(f.read_text("utf8"),filename=str(f))
print("MODEL_HANDOFF_STATIC_PASS: 12 cases, 10/30bps winner, 0.25 gross, 5m exit evidence, profile registry, Python syntax")
