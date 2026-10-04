import sys,json,pathlib
# args: variant hvs rev pb hype v12 fet dogeV12 mrShort brkShort residual
variant=sys.argv[1];hvs=float(sys.argv[2]);rev=float(sys.argv[3]);pb=float(sys.argv[4]);hypecap=float(sys.argv[5]);v12cap=float(sys.argv[6]);fetcap=float(sys.argv[7]);dogecap=float(sys.argv[8]);mrcap=float(sys.argv[9]);brkcap=float(sys.argv[10]);rescap=float(sys.argv[11])
repo=pathlib.Path(r"C:\tmp\pengu-hype-bt-20261004");sys.path.insert(0,str(repo))
from scripts.research.pengu1_hype_engine import load_extended_engine
from scripts.research.run_pengu1_hype_comparison import build_hype_candidates
from scripts.research import run_formal_core_overlay_diagnostic as base
from scripts.research.formal_core_ownership_audit import rows,find_ownership_conflicts
baseline=pathlib.Path(r"C:\tmp\bt-v12-score100-volume080-normalonly-20260928\extracted\bt-v12-score100-volume080-normalonly-20260928")
data=baseline/"market-Aster-H1-funding-and-manifests";candidate_root=pathlib.Path(r"C:\tmp\pengu-integrated-variants\structural\candidates")
features=pathlib.Path(r"C:\tmp\pengu-integrated-research\formal-overlay-features.jsonl");hf=pathlib.Path(r"C:\tmp\pengu-integrated-research\hype75-features.jsonl")
out=pathlib.Path(r"C:\tmp\dd-research")/variant;out.mkdir(parents=True,exist_ok=True)
hype,_=build_hype_candidates(data,hf,1786406400000);m=load_extended_engine(pengu_fixed=True);extra,_=base.overlay_candidates(rows(features),data,True,True,m.PERIOD_END_MS);reader=m._rows
m._rows=lambda path: reader(path)+hype+extra if pathlib.Path(path)==candidate_root/"crypto-price-model-candidates.jsonl" else reader(path)
orig=m._research_risk_cap
def custom(c,risk):
 v=orig(c,risk);sid=c.get("strategy_id");side=c.get("side");fam=str(c.get("family") or "").upper();sym=str(c.get("symbol") or "")
 if sid=="Q102":
  if fam=="HIGH_VOL" and side=="SHORT":v=min(v,hvs)
  if fam=="REV" and side=="SHORT":v=min(v,rev)
  if fam=="PB" and side=="LONG":v=min(v,pb)
  if fam=="MR" and side=="SHORT":v=min(v,mrcap)
  if fam=="BRK" and side=="SHORT":v=min(v,brkcap)
 if sid=="HYPE_LONG":v=min(v,hypecap)
 if sid=="V12":
  v=min(v,v12cap)
  if sym=="DOGEUSDT":v=min(v,dogecap)
 if sid=="FET":v=min(v,fetcap)
 if sid=="RESIDUAL":v=min(v,rescap)
 return v
m._research_risk_cap=custom
caps={"Q102_BRK":0.75,"Q102_MR":0.75,"FET":1.0}
res=m.run_portfolio_model(data,candidate_root,out,v52_ledger_root=baseline/"v52-SHA-verified-original-ledger",ecb_fx_root=data,cost_scenarios=(("PRICE_MODEL_10BPS",10.0),),research_risk_caps=caps)
s=res["scenarios"][0];tr=rows(out/"PRICE_MODEL_10BPS"/"portfolio-trades.jsonl");conf=find_ownership_conflicts(tr)
z={k:s[k] for k in ("final_equity_jpy","profit_factor","maximum_mtm_drawdown","closed_trades","strategy_trades","strategy_pnl_jpy")};z.update(variant=variant,hvs=hvs,rev=rev,pb=pb,hype=hypecap,v12=v12cap,fet=fetcap,doge=dogecap,mr=mrcap,brk=brkcap,residual=rescap,ownership_conflicts=len(conf),accounting=s["accounting_reconciliation"]["status"])
(out/"dd-summary.json").write_text(json.dumps(z,indent=2,sort_keys=True)+"\n");print(json.dumps(z),flush=True)
