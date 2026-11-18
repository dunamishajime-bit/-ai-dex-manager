"""IDLE one-slot vNext and no-op online gate: synthetic provenance tests."""
import copy,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_idle_vnext_online_forward_audit import build,vnext,online_confirm,pretarg_stops,TARGET_START,TARGET_END
SYMS=("RENDERUSDT","DOTUSDT","JUPUSDT","TIAUSDT")
def perf(n,wr=.55):
    a=n//4
    by={s:a for s in SYMS};by[SYMS[-1]]+=n-sum(by.values())
    return {"n":n,"winRate":wr,"meanReturn":.01,"sumReturn":n*.01,
        "profitFactor":1.3,"tradeCloseMaxDD":-.2,
        "bySymbol":by,"bySide":{"LONG":n//2,"SHORT":n-n//2}}
def core():
    comp={
      "RENDERUSDT":{"kind":"fixed","side":"SHORT"},
      "DOTUSDT":{"kind":"fixed","side":"LONG"},
      "JUPUSDT":{"kind":"online"},
      "TIAUSDT":{"kind":"online"}}
    counts={"RENDERUSDT":{"signalsTarget":78,"signalsForward":14},
       "DOTUSDT":{"signalsTarget":84,"signalsForward":12},
       "JUPUSDT":{"signalsTarget":207,"signalsForward":41},
       "TIAUSDT":{"signalsTarget":199,"signalsForward":20}}
    a=[{"entryTs":TARGET_START+i*3600000,"exitTs":TARGET_START+(i+1)*3600000,
       "symbol":SYMS[i%4],"side":"LONG","source":"ASTER"}
       for i in range(270)]
    a.extend([{"entryTs":TARGET_END+i*3600000,"exitTs":TARGET_END+(i+1)*3600000,
       "symbol":SYMS[i%4],"side":"SHORT","source":"GAP"} for i in range(33)])
    return {"status":"RESEARCH_ONLY_IDLE_VNEXT_CORE_1X_ONE_SLOT",
       "selectionUsesTarget":False,
       "priorityRule":"descending worst/pretarget validation mean only; never target metrics",
       "acceptedN":303,"blockedN":352,"accepted":a,
       "components":comp,"componentSignalCounts":counts,
       "target10":perf(270),"target30":perf(270,.54),
       "forward10":perf(33),"forward30":perf(33,.66)}
def online():
    ref={"n":218,"wr":.5,"mean":.01,"sum":2.18}
    return {"status":"RESEARCH_ONLY_IDLE_ALL5P_ONLINE_CONFIRMATION_GATE",
       "selectionUsesTarget":False,"rows":[{} for _ in range(218)],
       "baseline10":ref,"confirmed10":copy.deepcopy(ref),
       "baseline30":ref,"confirmed30":copy.deepcopy(ref),
       "summary":{"JUPUSDT":{"fixedN":66,"coveredN":66,"confirmN":66,"opposeN":0},
                  "TIAUSDT":{"fixedN":65,"coveredN":65,"confirmN":65,"opposeN":0}}}
def stops():
    opts=[]
    for value in (None,.08,.10,.04,.05,.06):
      pre={s:{"n":5,"mean":.01,"sum":.05} for s in ("E1","E2","E3")}
      opts.append({"stops":{s:value for s in SYMS},"pre30":pre,
        "TARGET30":{"n":270,"wr":.54,"mean":.01},
        "FORWARD30":{"n":33,"wr":.66,"mean":.01}})
    return {"status":"RESEARCH_ONLY_IDLE_V3_UNIFORM_STOP_PRETARGET_SELECTED",
        "selectionUsesTarget":False,"qualifyingPretarget":6,
        "stopsTested":[None,.03,.04,.05,.06,.08,.10],"topPretargetFrozen":opts}
class IdleVnextForwardTests(unittest.TestCase):
 def test_complete_model_is_research_only(self):
    x=build(core(),online(),stops())
    self.assertEqual(x["vnextCore"]["modelTargetN"],270)
    self.assertEqual(x["vnextCore"]["modelForwardN"],33)
    self.assertFalse(x["sourcePinCurrentLiveCertified"])
    self.assertFalse(x["fullPortfolioSharedGrossAndSTOPCertified"])
 def test_target_period_never_selects_candidate(self):
    x=core();x["selectionUsesTarget"]=True
    with self.assertRaisesRegex(ValueError,"SELECTION_POLICY_DRIFT"):
      vnext(x)
 def test_one_slot_source_admissions_303_exact(self):
    x=core();x["accepted"][1]["entryTs"]=TARGET_START-3600000
    with self.assertRaisesRegex(ValueError,"ENTRY_NOT_MONOTONIC"):
      vnext(x)
 def test_target_forward_model_count_integrity(self):
    x=core();x["target30"]["n"]=269
    with self.assertRaisesRegex(ValueError,"POPULATION_DRIFT"):
      vnext(x)
 def test_blocked_signal_population_integrity(self):
    x=core();x["blockedN"]=350
    with self.assertRaisesRegex(ValueError,"ADMITTED_BLOCKED_SET_DRIFT"):
      vnext(x)
 def test_online_noop_must_not_be_promoted_as_gain(self):
    x=online();x["confirmed30"]["mean"]=.02
    with self.assertRaisesRegex(ValueError,"ONLINE_GATE_NOT_NOOP"):
      online_confirm(x)
 def test_online_opposite_authorization_not_assumed(self):
    x=online();x["summary"]["JUPUSDT"]["opposeN"]=1
    with self.assertRaisesRegex(ValueError,"ONLINE_OPPOSITE_CONFIRMATION_CHANGED"):
      online_confirm(x)
 def test_uniform_stops_must_match_all_four_symbols(self):
    x=stops();x["topPretargetFrozen"][1]["stops"]["DOTUSDT"]=.1
    with self.assertRaisesRegex(ValueError,"UNIFORM_STOP_NOT_SAME"):
      pretarg_stops(x)
 def test_frozen_no_stop_has_to_match_vnext_forward(self):
    x=stops();x["topPretargetFrozen"][0]["FORWARD30"]["wr"]=.1
    with self.assertRaisesRegex(ValueError,"CORE_CASE_DISAGREE"):
      build(core(),online(),x)
if __name__=="__main__":unittest.main()
