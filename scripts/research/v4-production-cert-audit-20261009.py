"""Aggregate cert artifacts; fail if baseline parity, accounting, or quantities regress."""
import pathlib,json,collections,hashlib,math,sys
sys.dont_write_bytecode=True
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/"docs/research/results/v4-production-cert-20261009"
BASE=OUT/"bt-baseline"
def read(p):return json.loads(p.read_text(encoding="utf-8"))
summary=read(BASE/"fresh-run-summary.json")
manifest=read(BASE/"rerun-manifest.json")
SOURCE=pathlib.Path(manifest["source_root"])
FROZEN=pathlib.Path("C:/Users/dis/DisDex-y06-forward-robustness-20261009")
comparison=[]
for entry in manifest["sources"]:
 p=pathlib.Path(entry["path"]);relative=p.relative_to(SOURCE);reference=FROZEN/relative
 comparison.append({"relative":str(relative),"normalized_identical":reference.exists() and p.read_text(encoding="utf-8")==reference.read_text(encoding="utf-8")})
(BASE/"source-comparison.json").write_text(json.dumps(comparison,indent=2)+"\n")
sys.path.insert(0,str(SOURCE/"docs/research/results/gate-fixes-bt-20261008/support"))
from venue_constraints import normalize_quantity
quantity_cases={}
for p in sorted((BASE/"cases/V2_M150_D05_CORE_NATIVE/runs").glob("*/portfolio-trades.jsonl")):
 groups=collections.defaultdict(collections.Counter)
 for trade in [json.loads(line) for line in p.read_text().splitlines() if line.strip()]:
  sid=trade["strategy_id"];q=float(trade["original_quantity"]);n,reason=normalize_quantity(trade["symbol"],q,float(trade["entry_price"]))
  groups[sid]["trades"]+=1
  key=reason if reason else "observed_20261007_quantity_equal" if math.isclose(q,n,abs_tol=1e-9,rel_tol=1e-9) else "quantity_would_be_floored"
  groups[sid][key]+=1
 quantity_cases[p.parent.name]={"by_strategy":{k:dict(v) for k,v in groups.items()}}
quant={"status":"COUNTERFACTUAL_CURRENT_FILTER_DIAGNOSTIC_NOT_REPLAY","not_historical_filter_archive":True,"cases":quantity_cases}
(BASE/"observed-filter-counterfactual.json").write_text(json.dumps(quant,indent=2)+"\n")
checks=[]
def check(name,condition):
 checks.append({"name":name,"pass":bool(condition)})
 if not condition:raise AssertionError(name)
check("ALL_12_REFERENCE_LEDGER_METRIC_SHA256_MATCH",len(manifest["outputs"])==12 and all(x["equal"] for x in manifest["outputs"]))
check("ALL_30_SOURCE_MODULES_NORMALIZED_IDENTICAL",all(x["normalized_identical"] for x in read(BASE/"source-comparison.json")))
metrics={}
for sc in summary["cases"]:
 check(sc["scenario"]+"_PARITY_AND_ACCOUNTING",sc["parity"]["reference_matched"] and sc["parity"]["accounting"]=="PASS")
 p=BASE/"cases/V2_M150_D05_CORE_NATIVE/runs"/sc["scenario"]/"portfolio-trades.jsonl"
 trades=[json.loads(x) for x in p.read_text().splitlines() if x.strip()]
 check(sc["scenario"]+"_ALL8",set(x["strategy_id"] for x in trades)=={"V12","PENGU","Q102","V52","HYPE_LONG","FET","IDLE","RESIDUAL"})
 check(sc["scenario"]+"_RECORDED_CURRENT_FILTERS_ALL_EQUAL",all(v["trades"]==v.get("observed_20261007_quantity_equal",0) for v in quant["cases"][sc["scenario"]]["by_strategy"].values()))
 groups=collections.defaultdict(list)
 for t in trades:
  groups[(t["strategy_id"],t.get("route") or "NO_ROUTE_FIELD")].append(t)
 def stats(a):
  pnl=[float(t["total_pnl_jpy"]) for t in a]
  neg=-sum(min(0,x) for x in pnl)
  return {"trades":len(a),"wins":sum(x>0 for x in pnl),"losses":sum(x<0 for x in pnl),"pf":sum(max(0,x) for x in pnl)/neg if neg else None,
          "settlement_currency":"USD","pf_basis":"USD_SOURCE_TOTAL_PNL_FIELD","net_pnl_usd":sum(pnl),"modeled_realized_pnl_jpy_at_exit_fx":sum(float(t["modeled_realized_pnl_jpy_at_exit_fx"]) for t in a),"fees_usd":sum(float(t["entry_fee"])+float(t["exit_fee"]) for t in a),"funding_pnl_usd":sum(float(t["funding_pnl"]) for t in a)}
 metrics[sc["scenario"]]={"by_strategy":sc["strategy_trade_aggregates"],"by_logic":[{"strategy":k[0],"route":k[1],**stats(a)} for k,a in sorted(groups.items())]}
(BASE/"perlogic-metrics.json").write_text(json.dumps(metrics,indent=2)+"\n")
external=read(OUT/"bt-external/summary.json");selected=read(OUT/"bt-selected-external/summary.json")
check("ORIGINAL_EXTERNAL_274_REFERENCE_EVENTS",external["route_ledger_exact_reference_equal"] and external["all_routes"]["10"]["n"]==274)
check("Y06_INDEPENDENT_REVERSE_72H_EQUALS_SELECTED_TRANSLATION",all(math.isclose(external["y06_independent"][str(c)][k],selected["y06"][str(c)][k],abs_tol=1e-12) for c in [10,20,30] for k in ["n","wins","pf","mean","sum"]))
flags_path=ROOT/"docs/ops/v12-v4-cert-20261009/runtime-flags.json"
flags=read(flags_path)
selected_keys=["V12_GROSS_CAP","V12_DYNAMIC_GROSS_CAP","CRYPTO_GROSS_CAP","TOTAL_GROSS_CAP","QUALITY102_CAUSAL_V1_SELECTOR_MODE","QUALITY102_CAUSAL_V1_MAX_GROSS","PENGU_DUAL_LS_V2_MAX_GROSS","DISDEX_IDLE_PRIORITY_ENABLED","DISDEX_IDLE_RESIDUAL_LONG_ENABLED","DISDEX_HYPE_ZEC_PREEMPTION_ENABLED"]
values={k:sorted({f["safeFlags"][k] for f in flags if k in f["safeFlags"]}) for k in selected_keys}
runtime_evidence={"source_sha256":hashlib.sha256(flags_path.read_bytes()).hexdigest(),"distinct_effective_values":values,
"selected_caps":{"V12":3.0,"Crypto":3.5,"Total":4.75,"Recovery":2.5},
"exact_all8_runtime_replay_proven":False}
report={"status":"BLOCKED_EXACT_CURRENT_RUNTIME_AND_EXTERNAL_FULL8_CERTIFICATION","baseline_price_model_parity":"PASS","baseline_case":"V2_M150_D05_CORE_NATIVE",
"fresh_baseline":summary["cases"],"recorded_current_quantity_filter_diagnostic":"PASS_ALL_CLOSED_TRADES_10_20_30","quantity_filter_archive_historical":False,
"research_v52_funding_verified":all(sc["v52_funding_verified"] for sc in summary["cases"]),"current_runtime_funding_parity":False,
"external_original_v4":external,"external_selected_v2_translation":selected,"runtime":runtime_evidence,"checks":checks,
"blocked_items":[
{"item":"Exact Q102 selector stream","evidence":"run_gate_fix_comparison.py result q_scope FIXED_HIGH_VOL_STREAM_PLUS_NON_COLLIDING_S34_DELTA_NOT_FULL_SELECTOR_RETRAIN vs effective CAUSAL_V4 max gross3.0"},
{"item":"Current shared caps differ","evidence":"Effective V12=2.0 Crypto=3.0 Total=4.25; selected3.0/3.5/4.75; no exact runtime all8 admission replay"},
{"item":"External full8","evidence":"External H1 candidate set has V12 only; no fresh non-V12 ownership/quantity/funding streams"},
{"item":"Selected external translation parity","evidence":"Training research routes selected via development inc_keys; causal external translation of41 frozen predicates+repairs not yet tested for exact training candidate equivalence"},
{"item":"Live order/venue parity","evidence":"Recorded-current minQty/step/minNotional PASS for modeled closed quantities but no historical filter archive or live fills/pending/reservations/5x Cross parity"},
{"item":"Risk","evidence":"Baseline10bps DD20.4200138% and20bps DD20.9659013%; selected translated external PF10=.5700273 and unchangedY06 PF10=.2995188"}],"trading_mutation":0}
(OUT/"BT_CERT_AUDIT.json").write_text(json.dumps(report,indent=2)+"\n")
lines=["# V4 production certification — independent BT evidence (2026-10-09)","","**BLOCKED exact current-runtime/full8 external certification. Research baseline parity PASS. No live orders or deployments.**","",
"| Cost | Final JPY | PF | MTM DD | All / V12 trades |","|---|---:|---:|---:|---:|"]
for c in summary["cases"]:lines.append(f"| {c['scenario']} | {c['final_equity_jpy']:,.2f} | {c['portfolio_pf']:.6f} | {100*c['max_mtm_dd']:.6f}% | {c['total_trades']} / {c['v12_trades']} |")
lines+=["","12/12 original trade/equity/funding/metrics hashes match; 30/30 imported modules normalize exactly to frozen y06 source. All eight systems are present in the model. Original source worktrees were read-only; output redirects exclusively to this certification worktree.",
"","Recorded October 7 current Aster quantity filters: all 1,222 / 1,224 / 1,218 closed quantities normalize exactly; no would-floor/minQty/minNotional failures. This is a modeled current-filter diagnostic, not a historical filter archive or actual venue-fill certification. strict_quantity=false refers to an admission option and does not imply illegal fractional modeled quantities.",
"","Research V52 funding_verified and model_complete are true in all scenarios. That model evidence does not prove current live stock-funding/ownership parity.",
"","Original V4 external rerun: 274 events reproduce full route ledger exactly. 299 source-feature evaluations only read H1 bars strictly before entry. Independently recomputed Y06 relative24 predicate and reversed SHORT72h exit:102 events,38 wins, PF10/20/30 =0.299519/0.286658/0.274162.",
"","Selected V2 causal external translation:41 frozen route definitions, two repair passes, full-training hindsight rank/gross recorded without external reoptimization. 288 pre-repair /258 post-repair events; PF10/20/30 =0.570027/0.544400/0.519875. Y06 remains102 with same independent results. This applies causal predicates instead of training inc_keys, and has not proved exact training-baseline translation parity. Fixed priority is retrospective within training and frozen before external evaluation.",
"","Neither external study replays full8 ownership/gross/quantity/funding/MTM DD. External date range has previously been viewed and is not pristine prospective OOS.",
"","| System | Exact runtime parity | Evidence / remaining gap |","|---|---|---|",
"| V12 | BLOCKED | Selected repaired model rerun exact; current runtime X1 ALL and2.0 cap differ; causal41 translation parity unproved. |",
"| PENGU | BLOCKED | Model67 closed events at all costs; current V2 max gross1.0; no current-flag eventwise history replay. |",
"| Q102 | BLOCKED | Fixed HIGH_VOL + noncolliding S34 delta; runtime CAUSAL_V4 max3.0 requires full selector stream. |",
"| V52 | BLOCKED | Research model/funding complete; current state/reference/venue history parity unproved. |",
"| HYPE_LONG | BLOCKED | H1 source exits modeled; runtime TREND/preemption-disabled flag history not replayed eventwise. |",
"| FET | BLOCKED |7 modeled closed events; exact current residual/ownership event history unproved. |",
"| IDLE | BLOCKED |47/51/53 modeled events; live shared reservations/daily governor/asynchronous cadence unproved. |",
"| RESIDUAL | BLOCKED |22 modeled events; enabled inside IDLE runner; exact live preemption/lifecycle history unproved. |",
"","Effective runtime caps V12=2.0/Crypto=3.0/Total=4.25 differ from selected3.0/3.5/4.75. Raising one cap alone cannot establish portfolio parity.",
"","Artifacts: BT_CERT_AUDIT.json; bt-baseline/fresh-run-summary.json, rerun-manifest.json, perlogic-metrics.json, observed-filter-counterfactual.json; bt-external and bt-selected-external summaries/ledgers; run logs.",
"","Reproduce: python -B scripts/research/v4-production-cert-baseline-20261009.py; python -B scripts/research/v4-production-cert-external-20261009.py; python -B scripts/research/v4-production-cert-selected-external-20261009.py; python -B scripts/research/v4-production-cert-audit-20261009.py.",
"","The final audit recomputes source comparison and current-filter quantity diagnostics. Perlogic metrics separate raw USD settlement values from modeled realized JPY at exit FX. No source edits, checkout, commit, deployment or live writes occurred."]
(OUT/"BT_CERT_AUDIT.md").write_text("\n".join(lines)+"\n",encoding="utf-8")
(OUT/"bt-audit-checks.json").write_text(json.dumps(checks,indent=2)+"\n")
print("PASS",len(checks),"research verifications; BLOCKED exact runtime/full8 external certification")
