#!/usr/bin/env python3
"""Stage S04: Q102 SHORT DD and loss-control against cumulative S02 HYPE LONG.
Research-only, latest confirmed 2026-10-17 full8 5m model. No LIVE changes.
Never reuse the former 2026-10-05 DD1296 anchor for selection.
"""
from __future__ import annotations
import json,hashlib,math
from pathlib import Path
import long_short_sequential_full8_bt_20261019 as seq
import sequential_full8_side_loss_metrics_20261019 as loss
ROOT=seq.ROOT
R=seq.REPORT
PREFIX="S04_RESIDUAL_LONG"
PREVIOUS_POLICY="CUM_S02_HYPE_LONG_INITIAL_WALLET_1P5"
PREVIOUS_SPEC=[seq.HYPE2]
OPTIONS=[
 {"id":"RESIDUAL_LONG_PROFIT_1P5_TO_0P25","target":"RESIDUAL","side":"LONG","axis":"profit_reversal",
  "arm_close_pct":.015,"locked_profit_pct":.0025,"stop_slip_bps":10},
 {"id":"RESIDUAL_LONG_PROFIT_2P5_TO_0P5","target":"RESIDUAL","side":"LONG","axis":"profit_reversal",
  "arm_close_pct":.025,"locked_profit_pct":.005,"stop_slip_bps":10},
 {"id":"RESIDUAL_LONG_INITIAL_WALLET_2P0","target":"RESIDUAL","side":"LONG","axis":"initial_adverse",
  "max_initial_wallet_loss_pct":.02,"stop_slip_bps":10},
 {"id":"RESIDUAL_LONG_INITIAL_WALLET_3P0","target":"RESIDUAL","side":"LONG","axis":"initial_adverse",
  "max_initial_wallet_loss_pct":.03,"stop_slip_bps":10}
]
def run():
 previous=json.loads((R/"SEQUENTIAL_STEP03_Q102SHORT_CARRY_FORWARD_20261019.json").read_text("utf8"))
 if previous["selected_option"] is not None:
  raise AssertionError("S03_RESEARCH_OPTION_SELECTED_REQUIRES_PREVIOUS_SPEC_UPDATE")
 seq.setup_for_runs()
 controls=[]
 for c in (10,30):
  x=seq.portfolio_run(PREVIOUS_POLICY,PREVIOUS_SPEC,c)
  previous=json.loads((R/f"SEQUENTIAL_S02_HYPE_LONG_INITIAL_WALLET_1P5_{c}BPS.json").read_text("utf8"))
  if not math.isclose(x["full8_final_jpy"],previous["full8_final_jpy"],rel_tol=1e-9):raise AssertionError("HYPE_CUMULATIVE_SOURCE_PARITY_FAIL")
  if x["full8_max_dd_pct"]!=previous["full8_max_dd_pct"]:raise AssertionError("HYPE_CUMULATIVE_DD_PARITY_FAIL")
  controls.append(x)
 print("S04_CONTROL_FROM_APPROVED_S02_HYPE_LOSS_CAP_EXACT_PASS",flush=True)
 base_loss={str(c):loss.losses(loss.ledger(PREVIOUS_POLICY,c)).get("RESIDUAL_LONG") for c in (10,30)}
 trials=[]
 for option in OPTIONS:
  policy=PREFIX+"_"+option["id"]
  case=[]
  for c in (10,30):
   outcome=seq.portfolio_run(policy,PREVIOUS_SPEC+[option],c)
   l=loss.losses(loss.ledger(policy,c)).get("RESIDUAL_LONG")
   ref=base_loss[str(c)]
   if not l or not ref:raise AssertionError("RESIDUAL_LONG_LOSS_LEDGER_MISSING")
   dd_delta=round(outcome["full8_max_dd_pct"]-controls[(c==30)]["full8_max_dd_pct"],5)
   saved_loss=round(l["sum_negative_wallet_contributions_pp"]-ref["sum_negative_wallet_contributions_pp"],5)
   worst=round(l["worst_trade_wallet_pct"]-ref["worst_trade_wallet_pct"],5)
   case.append({"cost_bps":c,"max_dd_pct":outcome["full8_max_dd_pct"],"dd_delta_pctpoints":dd_delta,
    "asset_jpy":outcome["full8_final_jpy"],"asset_delta_jpy":outcome["full8_final_jpy"]-controls[(c==30)]["full8_final_jpy"],
    "RESIDUAL_LONG_baseline":ref,"RESIDUAL_LONG_candidate":l,"saved_aggregate_wallet_loss_pp":saved_loss,
    "worst_loss_reduction_pctpoints":worst,"exit_audit":outcome["exit_audit"]})
  dd_both=all(x["dd_delta_pctpoints"]>.0001 for x in case)
  loss_both=all(x["dd_delta_pctpoints"]>=-.0001 and x["saved_aggregate_wallet_loss_pp"]>=1 for x in case)
  trials.append({"option":option,"policy":policy,"cases":case,"accept_dd_both_costs":dd_both,
                 "accept_loss_reduction_flat_dd_both_costs":loss_both})
  print("RESIDUAL_LONG_TRIAL",option["id"],"DD",case[0]["max_dd_pct"],case[1]["max_dd_pct"],
   "LOSSSAVED",case[0]["saved_aggregate_wallet_loss_pp"],case[1]["saved_aggregate_wallet_loss_pp"],
   "JPY10",round(case[0]["asset_jpy"]),flush=True)
 eligible=[x for x in trials if x["accept_dd_both_costs"] or x["accept_loss_reduction_flat_dd_both_costs"]]
 chosen=max(eligible,key=lambda x:(x["accept_dd_both_costs"],
   min(x["cases"][0]["dd_delta_pctpoints"],x["cases"][1]["dd_delta_pctpoints"]),
   min(x["cases"][0]["saved_aggregate_wallet_loss_pp"],x["cases"][1]["saved_aggregate_wallet_loss_pp"]))) if eligible else None
 accepted=PREVIOUS_SPEC+[chosen["option"]] if chosen else PREVIOUS_SPEC
 out={"status":"S04_COMPLETE_RESEARCH_ONLY_NOT_LIVE_CERTIFIED",
 "reference_input_sha256":hashlib.sha256((R/"SEQUENTIAL_STEP03_Q102SHORT_CARRY_FORWARD_20261019.json").read_bytes()).hexdigest(),
 "stage":"S04","predecessor":"S02 HYPE LONG wallet STOP=1.5% (flat DD, lower loss both costs) provisional research carry-forward",
 "source":"2026-10-17 full8 5m frozen replay",
 "controls":controls,"baseline_target_loss":base_loss,
 "trials":trials,
 "selected_option":chosen["option"]["id"] if chosen else None,
 "output_cumulative_specs":accepted,
 "for_following_bt_reference":chosen["cases"] if chosen else controls,
 "warnings":["Not a certified Aster signed STOP lifecycle","Model M5 normalized public data","In-sample research, requires forward/out-of-sample",
 "No changes to LIVE or operator approval"] }
 result=R/"SEQUENTIAL_STEP04_RESIDUALLONG_CARRY_FORWARD_20261019.json"
 result.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
 print("S04_DECISION","SELECTED" if chosen else "NO_ADOPTION",chosen["option"]["id"] if chosen else "UNMODIFIED_CUM_HYPE_1P5",
   "OUTPUT",str(result),flush=True)
if __name__=="__main__":run()
