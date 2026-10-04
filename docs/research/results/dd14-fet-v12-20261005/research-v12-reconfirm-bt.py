import sys,json,pathlib
variant=sys.argv[1]; loss_n=int(sys.argv[2]); lookback=int(sys.argv[3]); scope=sys.argv[4]
candidate_root=pathlib.Path(r"C:\tmp\dd-candidates\FET_R72_2P")
repo=pathlib.Path(r"C:\tmp\pengu-hype-bt-20261004");sys.path.insert(0,str(repo))
from scripts.research.pengu1_hype_engine import transform_source
from scripts.research.run_pengu1_hype_comparison import build_hype_candidates
from scripts.research.formal_core_live_ownership import load_ownership_engine,prepare_overlay_batch
from scripts.research import run_formal_core_overlay_diagnostic as base
from scripts.research.formal_core_ownership_audit import rows,find_ownership_conflicts

def patch(source):
    source=transform_source(source,True)
    marker='    v12_cooldown_by_symbol: dict[str, int] = defaultdict(int)\n'
    source=source.replace(marker,marker+'    fet_reentry_until = 0\n    v12_side_loss_streak: dict[str, int] = defaultdict(int)\n',1)
    marker='        nonlocal wallet, pengu_risk_equity, pengu_risk_peak, pengu_hold_until, pengu_cooldown_until\n'
    source=source.replace(marker,'        nonlocal wallet, pengu_risk_equity, pengu_risk_peak, pengu_hold_until, pengu_cooldown_until, fet_reentry_until\n',1)
    marker='        record_day_pnl(ts, cash)\n'
    source=source.replace(marker,marker+'        if position["strategy_id"] == "FET": fet_reentry_until = max(fet_reentry_until, ts + 24 * HOUR)\n',1)
    marker=('            v12_cooldown_by_symbol[symbol] = ts + hours * HOUR\n'
            '        if position["strategy_id"] == "PENGU":\n')
    insert=(f'            v12_cooldown_by_symbol[symbol] = ts + hours * HOUR\n'
            f'            side_key = str(position["side"])\n'
            f'            if total < 0: v12_side_loss_streak[side_key] += 1\n'
            f'            elif total > 0: v12_side_loss_streak[side_key] = 0\n'
            f'        if position["strategy_id"] == "PENGU":\n')
    assert marker in source;source=source.replace(marker,insert,1)
    marker=('                if strategy == "V12" and ts < v12_cooldown_by_symbol[candidate["symbol"]]:\n'
            '                    record_decision(candidate, "REJECTED_PORTFOLIO", "V12:SYMBOL_COOLDOWN", ts)\n'
            '                    rejected["V12:SYMBOL_COOLDOWN"] += 1\n'
            '                    continue\n\n')
    gate=(marker+
        '                if strategy == "FET" and ts < fet_reentry_until:\n'
        '                    record_decision(candidate, "REJECTED_PORTFOLIO", "FET:REENTRY_COOLDOWN", ts)\n'
        '                    rejected["FET:REENTRY_COOLDOWN"] += 1\n'
        '                    continue\n'
        +f'                if strategy == "V12" and v12_side_loss_streak[str(candidate["side"])] >= {loss_n}:\n'
        +'                    end_ts = ts - HOUR\n'
        +f'                    start_ts = ts - ({lookback} + 1) * HOUR\n'
        +'                    btc_end = _mark(market, "BTCUSDT", end_ts)\n'
        +'                    btc_start = _mark(market, "BTCUSDT", start_ts)\n'
        +'                    asset_end = _mark(market, candidate["symbol"], end_ts)\n'
        +'                    asset_start = _mark(market, candidate["symbol"], start_ts)\n'
        +'                    if not all(v is not None and v > 0 for v in [btc_end,btc_start,asset_end,asset_start]):\n'
        +'                        record_decision(candidate, "REJECTED_PORTFOLIO", "V12:LOSS_RECONFIRM_MISSING", ts)\n'
        +'                        rejected["V12:LOSS_RECONFIRM_MISSING"] += 1\n'
        +'                        continue\n'
        +'                    btc_ret = btc_end / btc_start - 1\n'
        +'                    asset_ret = asset_end / asset_start - 1\n'
        +'                    aligned_btc = btc_ret < 0 if candidate["side"] == "SHORT" else btc_ret > 0\n'
        +'                    aligned_asset = asset_ret < 0 if candidate["side"] == "SHORT" else asset_ret > 0\n'
        +f'                    aligned = aligned_btc if "{scope}" == "BTC" else (aligned_btc and aligned_asset)\n'
        +'                    if not aligned:\n'
        +'                        record_decision(candidate, "REJECTED_PORTFOLIO", "V12:LOSS_RECONFIRM_BLOCK", ts)\n'
        +'                        rejected["V12:LOSS_RECONFIRM_BLOCK"] += 1\n'
        +'                        continue\n\n')
    assert marker in source;source=source.replace(marker,gate,1)
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
data=baseline/"market-Aster-H1-funding-and-manifests";features=pathlib.Path(r"C:\tmp\pengu-integrated-research\formal-overlay-features.jsonl");hf=pathlib.Path(r"C:\tmp\pengu-integrated-research\hype75-features.jsonl")
out=pathlib.Path(r"C:\tmp\dd-research")/variant;out.mkdir(parents=True,exist_ok=True)
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
z={k:s[k] for k in ("final_equity_jpy","profit_factor","maximum_mtm_drawdown","closed_trades","strategy_trades","strategy_pnl_jpy","rejected_entries")}
z.update(variant=variant,loss_n=loss_n,lookback=lookback,scope=scope,ownership_conflicts=len(conf),accounting=s["accounting_reconciliation"]["status"])
(out/"dd-summary.json").write_text(json.dumps(z,indent=2,sort_keys=True)+"\n")
print(json.dumps(z),flush=True)
