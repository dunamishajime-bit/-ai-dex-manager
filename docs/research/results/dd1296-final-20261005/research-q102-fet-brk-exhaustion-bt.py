import sys,json,pathlib
variant=sys.argv[1]; rule=sys.argv[2]; brk_threshold=float(sys.argv[3])
repo=pathlib.Path(r"C:\tmp\pengu-hype-bt-20261004"); sys.path.insert(0,str(repo))
from scripts.research.pengu1_hype_engine import transform_source
from scripts.research.run_pengu1_hype_comparison import build_hype_candidates
from scripts.research.formal_core_live_ownership import load_ownership_engine,prepare_overlay_batch
from scripts.research import run_formal_core_overlay_diagnostic as base
from scripts.research.formal_core_ownership_audit import rows,find_ownership_conflicts

def patch(source):
    source=transform_source(source,True)
    marker='    v12_cooldown_by_symbol: dict[str, int] = defaultdict(int)\n'
    source=source.replace(marker,marker+'    fet_reentry_until = 0\n    v12_side_loss_streak: dict[str, int] = defaultdict(int)\n    v12_side_loss_until: dict[str, int] = defaultdict(int)\n',1)
    marker='        nonlocal wallet, pengu_risk_equity, pengu_risk_peak, pengu_hold_until, pengu_cooldown_until\n'
    source=source.replace(marker,'        nonlocal wallet, pengu_risk_equity, pengu_risk_peak, pengu_hold_until, pengu_cooldown_until, fet_reentry_until\n',1)
    marker='        record_day_pnl(ts, cash)\n'
    source=source.replace(marker,marker+'        if position["strategy_id"] == "FET": fet_reentry_until = max(fet_reentry_until, ts + 24 * HOUR)\n',1)
    marker=('            v12_cooldown_by_symbol[symbol] = ts + hours * HOUR\n'
            '        if position["strategy_id"] == "PENGU":\n')
    insert=('            v12_cooldown_by_symbol[symbol] = ts + hours * HOUR\n'
            '            side_key = str(position["side"])\n'
            '            if total < 0:\n'
            '                v12_side_loss_streak[side_key] += 1\n'
            '                if v12_side_loss_streak[side_key] >= 6:\n'
            '                    v12_side_loss_until[side_key] = max(v12_side_loss_until[side_key], ts + 6 * HOUR)\n'
            '            elif total > 0:\n'
            '                v12_side_loss_streak[side_key] = 0\n'
            '        if position["strategy_id"] == "PENGU":\n')
    assert marker in source; source=source.replace(marker,insert,1)
    marker=('                if strategy == "V12" and ts < v12_cooldown_by_symbol[candidate["symbol"]]:\n'
            '                    record_decision(candidate, "REJECTED_PORTFOLIO", "V12:SYMBOL_COOLDOWN", ts)\n'
            '                    rejected["V12:SYMBOL_COOLDOWN"] += 1\n'
            '                    continue\n\n')
    extra=(marker
      +'                if strategy == "FET" and ts < fet_reentry_until:\n'
      +'                    record_decision(candidate, "REJECTED_PORTFOLIO", "FET:REENTRY_COOLDOWN", ts); rejected["FET:REENTRY_COOLDOWN"] += 1; continue\n'
      +'                if strategy == "V12" and ts < v12_side_loss_until[str(candidate["side"])]:\n'
      +'                    record_decision(candidate, "REJECTED_PORTFOLIO", "V12:SIDE_LOSS_COOLDOWN", ts); rejected["V12:SIDE_LOSS_COOLDOWN"] += 1; continue\n'
      +'                if strategy == "Q102" and str(candidate.get("family") or "").upper()=="BRK" and candidate["symbol"]=="FETUSDT" and candidate["side"]=="SHORT":\n'
      +'                    fnow = _mark(market, "FETUSDT", ts)\n'
      +'                    f72 = _mark(market, "FETUSDT", ts - 72 * HOUR)\n'
      +f'                    if fnow is not None and f72 is not None and (fnow/f72 - 1) <= {brk_threshold}:\n'
      +'                        record_decision(candidate, "REJECTED_PORTFOLIO", "Q102:BRK_FET_SHORT_EXHAUSTION", ts); rejected["Q102:BRK_FET_SHORT_EXHAUSTION"] += 1; continue\n'
      +'                if strategy == "V12":\n'
      +'                    sg = 1 if candidate["side"] == "LONG" else -1\n'
      +'                    sym = candidate["symbol"]\n'
      +'                    nowp = _mark(market, sym, ts)\n'
      +'                    p3 = _mark(market, sym, ts - 3 * HOUR)\n'
      +'                    p6 = _mark(market, sym, ts - 6 * HOUR)\n'
      +'                    bnow = _mark(market, "BTCUSDT", ts)\n'
      +'                    b3 = _mark(market, "BTCUSDT", ts - 3 * HOUR)\n'
      +'                    b6 = _mark(market, "BTCUSDT", ts - 6 * HOUR)\n'
      +'                    dr3 = None if None in [nowp,p3,bnow,b3] else sg*((nowp/p3-1)-(bnow/b3-1))\n'
      +'                    dr6 = None if None in [nowp,p6,bnow,b6] else sg*((nowp/p6-1)-(bnow/b6-1))\n'
      +'                    db3 = None if None in [bnow,b3] else sg*(bnow/b3-1)\n'
      +'                    db6 = None if None in [bnow,b6] else sg*(bnow/b6-1)\n')
    if rule=="AVAX":
        extra+=('                    if sym=="AVAXUSDT" and candidate["side"]=="SHORT" and int(candidate.get("rank") or 0)==1 and db3 is not None and db3>0 and dr3 is not None and dr3<=-0.0075:\n'
                '                        record_decision(candidate,"REJECTED_PORTFOLIO","V12:AVAX_R1_SHORT_REBOUND",ts); rejected["V12:AVAX_R1_SHORT_REBOUND"] += 1; continue\n')
    elif rule=="SOL":
        extra+=('                    if sym=="SOLUSDT" and candidate["side"]=="SHORT" and int(candidate.get("rank") or 0)==2 and db6 is not None and db6>0 and dr6 is not None and dr6<=-0.01:\n'
                '                        record_decision(candidate,"REJECTED_PORTFOLIO","V12:SOL_R2_SHORT_REBOUND",ts); rejected["V12:SOL_R2_SHORT_REBOUND"] += 1; continue\n')
    elif rule=="BOTH":
        extra+=('                    if sym=="AVAXUSDT" and candidate["side"]=="SHORT" and int(candidate.get("rank") or 0)==1 and db3 is not None and db3>0 and dr3 is not None and dr3<=-0.0075:\n'
                '                        record_decision(candidate,"REJECTED_PORTFOLIO","V12:AVAX_R1_SHORT_REBOUND",ts); rejected["V12:AVAX_R1_SHORT_REBOUND"] += 1; continue\n'
                '                    if sym=="SOLUSDT" and candidate["side"]=="SHORT" and int(candidate.get("rank") or 0)==2 and db6 is not None and db6>0 and dr6 is not None and dr6<=-0.01:\n'
                '                        record_decision(candidate,"REJECTED_PORTFOLIO","V12:SOL_R2_SHORT_REBOUND",ts); rejected["V12:SOL_R2_SHORT_REBOUND"] += 1; continue\n')
    elif rule=="R1GEN":
        extra+=('                    if candidate["side"]=="SHORT" and int(candidate.get("rank") or 0)==1 and db3 is not None and db3>0 and dr3 is not None and dr3<=-0.0075:\n'
                '                        record_decision(candidate,"REJECTED_PORTFOLIO","V12:R1_SHORT_REBOUND",ts); rejected["V12:R1_SHORT_REBOUND"] += 1; continue\n')
    elif rule=="NONE":pass
    else:raise ValueError(rule)
    assert marker in source; source=source.replace(marker,extra+'\n',1)
    return source

m=load_ownership_engine(source_transform=patch)
old=m._strategy_cap;m._strategy_cap=lambda c:1.5 if c['strategy_id']=='HYPE_LONG' else old(c);m.PRIORITY['HYPE_LONG']=7
def batch(rs,active,completed,ts,market,equity,gross,finalize,lifecycle):
    prepare_overlay_batch(rs,active,completed,ts,market,equity,gross,finalize,lifecycle)
    if any(p['strategy_id']=='HYPE_LONG' for p in active.values()):
        for row in rs:
            if row['strategy_id'] in {'IDLE','RESIDUAL'} and not row.get('_overlay_block'):row['_overlay_block']='HYPE_SIDECAR_ACTIVE'
m._prepare_overlay=batch
baseline=pathlib.Path(r"C:\tmp\bt-v12-score100-volume080-normalonly-20260928\extracted\bt-v12-score100-volume080-normalonly-20260928")
data=baseline/"market-Aster-H1-funding-and-manifests"; candidate_root=pathlib.Path(r"C:\tmp\dd-candidates\FET_R72_2P")
features=pathlib.Path(r"C:\tmp\pengu-integrated-research\formal-overlay-features.jsonl");hf=pathlib.Path(r"C:\tmp\pengu-integrated-research\hype75-features.jsonl")
out=pathlib.Path(r"C:\tmp\q102-fet-brk-bt")/variant;out.mkdir(parents=True,exist_ok=True)
hype,_=build_hype_candidates(data,hf,1786406400000);extra,_=base.overlay_candidates(rows(features),data,True,True,m.PERIOD_END_MS);reader=m._rows
m._rows=lambda path: reader(path)+hype+extra if pathlib.Path(path)==candidate_root/"crypto-price-model-candidates.jsonl" else reader(path)
orig=m._research_risk_cap
def cap(c,risk):
 v=orig(c,risk);sid=c.get("strategy_id");side=c.get("side");fam=str(c.get("family") or "").upper()
 if sid=="Q102":
  if fam=="HIGH_VOL" and side=="SHORT":v=min(v,.7)
  if fam=="REV" and side=="SHORT":v=min(v,1.25)
  if fam=="PB" and side=="LONG":v=min(v,2.0)
 return v
m._research_risk_cap=cap
caps={"Q102_BRK":0.75,"Q102_MR":0.75,"FET":1.0}
res=m.run_portfolio_model(data,candidate_root,out,v52_ledger_root=baseline/"v52-SHA-verified-original-ledger",ecb_fx_root=data,cost_scenarios=(("PRICE_MODEL_10BPS",10.0),),research_risk_caps=caps)
s=res["scenarios"][0];tr=rows(out/"PRICE_MODEL_10BPS"/"portfolio-trades.jsonl");conf=find_ownership_conflicts(tr)
v=[x for x in tr if x.get("strategy_id")=="V12"];wins=sum(float(x["total_pnl_jpy"])>0 for x in v)
z={k:s[k] for k in ("final_equity_jpy","profit_factor","maximum_mtm_drawdown","closed_trades","strategy_trades","strategy_pnl_jpy","rejected_entries")}
z.update(rule=rule,brk_threshold=brk_threshold,v12_trades=len(v),v12_wins=wins,v12_losses=len(v)-wins,ownership_conflicts=len(conf),accounting=s["accounting_reconciliation"]["status"])
(out/"summary.json").write_text(json.dumps(z,indent=2,sort_keys=True)+"\n")
print(json.dumps(z),flush=True)
