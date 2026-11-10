from pathlib import Path
import json,hashlib,datetime
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
D=R/"DIRECTION_RESEARCH_20261109"
def load(p):return json.loads(Path(p).read_text(encoding="utf-8-sig"))
impl=R/"VPS_DD_3GATE_STATIC_V4Y06_DYNAMIC_FRAGILE12_STOCK15_20261110"
causal=R/"VPS_CAUSAL_V4CORE_ON_3GATE_STOCK15_20261110"
causaloff=R/"VPS_CAUSAL_V4CORE_OFF_3GATE_STOCK15_20261110"
def pair(folder,prefix):
 out={}
 for c in (10,30):
  z=load(folder/f"{prefix}_{c}BPS_SUMMARY.json")
  out[str(c)]={k:z[k] for k in ["final_compounded_jpy","max_hourly_dd_pct","win_rate_pct","profit_factor","modeled_fills"]}
 return out
implementation=pair(impl,"Y06_NATIVE_LIFECYCLE_M5_AB")
causal_on=pair(causal,"CAUSAL_V4CORE_ON_3GATE")
causal_off=pair(causaloff,"CAUSAL_V4CORE_OFF_3GATE")
idle=load(D/"idle_jup_train_validation_forward_gate_search_20261110.json")
pengu=load(D/"pengu_v8_train_validation_forward_gate_search_20261110.json")
q102=load(D/"q102_fet_coarse_train_valid_forward_screen_20261110.json")
v4f=load(D/"FORWARD_NATIVE_V4_CLEAN_20261110"/"forward-native-v4-clean-exit-summary.json")
det=load(causal/"DETERMINISM_RECHECK_20261110.json")
report={
 "status":"BT_RESEARCH_COMPLETE_NOT_PRODUCTION_CERTIFIED",
 "completedAtUtc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
 "period":{"historical":["2025-10-01T00:00:00Z","2026-10-01T00:00:00Z"],"forward":["2026-10-01T00:00:00Z","2026-11-08T20:00:00Z"]},
 "initialJpy":10000,
 "fixedProfitTargetUsed":False,
 "evaluationPriority":["causality","max_drawdown","win_rate","profit_after_costs","trade_count"],
 "implementationReplayBestBalanced":{"status":"RETROSPECTIVE_V4_V2_CONTAMINATED_NOT_CAUSAL_CERTIFICATE","results":implementation,
   "rules":["IDLE JUP rel24 >= -0.04089204262472046","PENGU V8 btc24h <= 0.011611625094354983","Q102 FET ret14 <= 0.048722800378429465",
            "V4 REC_Y concurrent gross cap 0.6x","portfolio DD <= -12% triggers PENGU+Q102+IDLE shared 2.0x cap"],
   "use":"implementation/research comparison only"},
 "causalConservative":{"status":"V4_V2_BODY_REMOVED_NATIVE_FAILED_BREAK_CORE_ONLY","withoutThreeGates":causal_off,"withThreeGates":causal_on,
   "v4":{"legacyV2CandidatesRemoved":1394,"nativeCoreHistoricalAdded":49,"cleanForwardSourceCandidates":184,
         "cleanForwardSourceComplete":v4f["sections"]["source"]["complete"],"cleanForwardSource":v4f["sections"]["source"],
         "cleanForwardCore":v4f["sections"]["core"]}},
 "forwardGateEvidence":{"IDLE_JUP":{"baseline30":idle["baseline"]["forward30"],"gated30":idle["robustCandidates"][0]["forward30"],
       "rule":idle["robustCandidates"][0]["rule"]},
   "PENGU_V8":{"baseline30":pengu["baseline"]["forward30"],"gated30":pengu["robust"][0]["forward30"],"rule":pengu["robust"][0]["rule"]},
   "Q102_FET":{"baseline30":q102["fwd30"],"gated30":q102["coarseRobustCandidates"][0]["fwd30"],"rule":q102["coarseRobustCandidates"][0]["rule"]}},
 "determinism":det,
 "acceptance":{"ddLe20Both":all(causal_on[str(c)]["max_hourly_dd_pct"]>=-20 for c in (10,30)),
               "winRateGe70Both":all(causal_on[str(c)]["win_rate_pct"]>=70 for c in (10,30)),
               "profitPositiveBoth":all(causal_on[str(c)]["final_compounded_jpy"]>10000 for c in (10,30))},
 "knownNonParity":["V52 historical executable order book unavailable; price-model proxy remains",
                   "RESIDUAL has 79 historical exit-model gaps fail-closed/inherited",
                   "market fills remain modeled rather than signed venue fills",
                   "current V4 live-decision builder imports V2 shadow policy; V2 full-year filtering is retrospective and cannot be used as causal evidence"],
 "conclusion":"Research BT is complete and reproducible. The implementation-replay variant materially improves DD but is not causal because V4 V2 candidates are retrospectively filtered. The causal-conservative variant removes all 1394 contaminated V4 body candidates and keeps only native FAILED_BREAK core. It remains profitable in both fee cases but does not meet DD<=20% or win-rate>=70%; therefore no LIVE adoption is justified by this BT alone."
}
out=D/"BT_FINAL_COMPLETION_20261110.json"
out.write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("FINAL_JSON",out)
print("SHA256",hashlib.sha256(out.read_bytes()).hexdigest())
print("CAUSAL10",causal_on["10"])
print("CAUSAL30",causal_on["30"])
print("ACCEPT",report["acceptance"])
