
from pathlib import Path
import csv, json, statistics, collections

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "research"
QUALITY = ROOT / "docs/research/results/v12-multilogic-v4-quality-refine-20261009/comparison-summary.json"
STAGE2 = ROOT / "docs/research/results/v12-recovery-stage2-search-20261008/selected-stage2-routes.json"
STAGE3 = ROOT / "docs/research/results/v12-recovery-stage3-extended-20261009/selected-stage3-routes-extended.json"
TRADES10 = ROOT / "docs/research/results/v12-multilogic-v4-quality-refine-20261009/cases/REF_G5_TIME48/runs/PRICE_MODEL_10BPS/portfolio-trades.jsonl"

FEATURE_GLOSSARY = {
"SIDE_SHORT":"source candidate side == SHORT","SIDE_LONG":"source candidate side == LONG",
"AGE_0_12":"0 <= momentum_condition_age_h < 12","AGE_12_24":"12 <= momentum_condition_age_h < 24",
"AGE_24_48":"24 <= momentum_condition_age_h < 48","AGE_48_72":"48 <= momentum_condition_age_h < 72",
"AGE_72_97":"72 <= momentum_condition_age_h < 97","RET6_NEG":"signed_6h_return < 0",
"RET6_0_05":"0 <= signed_6h_return < 0.5%","RET6_05_15":"0.5% <= signed_6h_return < 1.5%",
"RET6_15_30":"1.5% <= signed_6h_return < 3.0%","RET6_GE30":"signed_6h_return >= 3.0%",
"EMA_LT0":"EMA12 distance ATR < 0","EMA_0_05":"0 <= EMA12 distance ATR < 0.5",
"EMA_05_10":"0.5 <= EMA12 distance ATR < 1.0","EMA_10_20":"1.0 <= EMA12 distance ATR < 2.0",
"EMA_GE20":"EMA12 distance ATR >= 2.0","BTC6_ALIGNED":"normalized BTC 6h >= 0",
"BTC6_OPPOSE":"normalized BTC 6h < 0","BTC24_ALIGNED":"normalized BTC 24h >= 0",
"BTC24_OPPOSE":"normalized BTC 24h < 0","REL12_POS":"symbol-vs-BTC 12h relative return > 0",
"REL12_NEG":"symbol-vs-BTC 12h relative return <= 0","REL24_POS":"symbol-vs-BTC 24h relative return > 0",
"REL24_NEG":"symbol-vs-BTC 24h relative return <= 0","BREAK24":"24h breakout distance ATR >= 0",
"NO_BREAK24":"24h breakout distance ATR < 0","VOL_GE1":"volume_ratio >= 1.0","VOL_LT1":"volume_ratio < 1.0",
"ER24_GE30":"ER24 >= 0.30","ER24_LT30":"ER24 < 0.30","RANGE_TOP25":"range_loc24 >= 0.75",
"RANGE_MID":"0.25 <= range_loc24 < 0.75","RANGE_BOTTOM25":"range_loc24 < 0.25",
"RANGE_NOT_TOP25":"range_loc24 < 0.75","PULLBACK_LT025":"pullback12_atr < 0.25",
"PULLBACK_025_15":"0.25 <= pullback12_atr <= 1.5","PULLBACK_GT15":"pullback12_atr > 1.5",
"COMPRESS":"compression <= 0.80","EXPAND":"compression >= 1.10","BODY_FAVOR":"normalized body_atr > 0",
"BODY_OPPOSE":"normalized body_atr <= 0","CLV_FAVOR":"normalized CLV >= 0.60","CLV_OPPOSE":"normalized CLV <= 0.40"
}
G_RULES = {
"REC_G1_MID_REL_LOWVOL":["SIDE_SHORT","RET6_05_15","REL12_POS","VOL_LT1"],
"REC_G2_EARLY_BTC_OPPOSE_VOL":["SIDE_SHORT","AGE_0_24","BTC6_OPPOSE","VOL_GE1"],
"REC_G3_LATE_BTC_REL":["SIDE_SHORT","AGE_72_97","BTC6_ALIGNED","REL12_POS"],
"REC_G4_MATURE_REL_RANGE":["SIDE_SHORT","AGE_48_72","REL24_POS","RANGE_NOT_TOP25"],
"REC_G5_SLOW_TREND":["SIDE_SHORT","RET6_0_05","BTC6_ALIGNED","ER24_LT30"]
}

quality=json.loads(QUALITY.read_text(encoding="utf-8"))
preferred=next(x for x in quality if x["case"]=="REF_G5_TIME48")
scenarios={x["scenario_id"]:x for x in preferred["scenarios"]}
stage2=json.loads(STAGE2.read_text(encoding="utf-8"))[:14]
stage3=json.loads(STAGE3.read_text(encoding="utf-8"))
included_stage3=set(range(1,20))|{21}
trades=[json.loads(x) for x in TRADES10.read_text(encoding="utf-8").splitlines() if x.strip()]
by_route=collections.defaultdict(list)
for t in trades:
    if t.get("strategy_id")=="V12": by_route[t.get("route")].append(t)

meta={}
meta["FAILED_BREAK_REV_SHORT_6H"]={
"family":"CORE","entry_rule_tokens":["FRESH_UPWARD_90H_ONSET","STRUCTURAL_UP_BREAK","FAIL_BACK_BELOW_LEVEL_WITHIN_6H","OPPOSITE_CLV_BODY_CONFIRM"],
"entry_rule_text":"fresh upward ~90h onset; structural upward breakout; fail below breakout within 6h; opposite CLV/body confirm; enter SHORT next H1 open",
"source_side":"LONG setup -> SHORT reversal","side_transform":"FORCE_SHORT","entry_delay_h":0,
"exit_policy":"INHERIT_V12_STATE_EXIT","requested_gross_policy":"INHERIT_CORE_DYNAMIC_UP_TO_1.0X","rank_policy":"core rank 1/2",
"minlift":"NO","opposite_preemption":"PROTECTED","route_slots":"CORE_POLICY"}
meta["CONT_SHORT_MID_AGE24_48"]={
"family":"ROBUST_COMPLEMENT","entry_rule_tokens":["SIDE_SHORT","AGE_24_48","RET6_05_15","EMA_GE_1ATR"],
"entry_rule_text":"SHORT; age 24-48h; signed 6h return 0.5%-1.5%; EMA12 distance >= 1 ATR",
"source_side":"SHORT","side_transform":"KEEP_SOURCE_SIDE","entry_delay_h":0,
"exit_policy":"INHERIT_V12_STATE_EXIT","requested_gross_policy":"MAX_0.25X","rank_policy":"rank 8",
"minlift":"YES_TO_MIN_VENUE_QTY_MAX_0.30X","opposite_preemption":"PROTECTED","route_slots":"ROBUST_POLICY"}

for route,tokens in G_RULES.items():
    meta[route]={"family":"RECOVERY_G","entry_rule_tokens":tokens,"entry_rule_text":" AND ".join(tokens),
    "source_side":"SHORT","side_transform":"KEEP_SOURCE_SIDE","entry_delay_h":0,
    "exit_policy":"TIME_48H_FIXED_REFINED" if route=="REC_G5_SLOW_TREND" else "INHERIT_V12_STATE_EXIT",
    "requested_gross_policy":"0.10X","rank_policy":"rank 9","minlift":"YES_TO_MIN_VENUE_QTY_MAX_0.30X",
    "opposite_preemption":"PREEMPTIBLE_BY_OPPOSITE_REC_Y","route_slots":"16"}

for i,r in enumerate(stage2,1):
    route=f"REC_X{i:02d}_{r['exit']}"
    meta[route]={"family":"RECOVERY_X","entry_rule_tokens":r["rule"],"entry_rule_text":" AND ".join(r["rule"]),
    "source_side":"SIDE_* token","side_transform":"KEEP_SOURCE_SIDE","entry_delay_h":0,"exit_policy":r["exit"],
    "requested_gross_policy":"0.10X","rank_policy":"rank 9","minlift":"YES_TO_MIN_VENUE_QTY_MAX_0.30X",
    "opposite_preemption":"PREEMPTIBLE_BY_OPPOSITE_REC_Y","route_slots":"16","discovery_stats":{k:v for k,v in r.items() if k!="inc_keys"}}

for n in sorted(included_stage3):
    r=stage3[n-1]; prefix="REC_Y" if str(r["exit"]).startswith("REV_") else "REC_Z"; route=f"{prefix}{n:02d}_{r['exit']}"
    delay=next((int(tok[1:]) for tok in str(r["exit"]).split("_") if tok.startswith("D") and tok[1:].isdigit()),0)
    meta[route]={"family":"RECOVERY_Y_REVERSAL" if prefix=="REC_Y" else "RECOVERY_Z_ORIGINAL",
    "entry_rule_tokens":r["rule"],"entry_rule_text":" AND ".join(r["rule"]),"source_side":"SIDE_* token",
    "side_transform":"FLIP_SOURCE_SIDE" if prefix=="REC_Y" else "KEEP_SOURCE_SIDE","entry_delay_h":delay,"exit_policy":r["exit"],
    "requested_gross_policy":"0.10X","rank_policy":"rank 9","minlift":"YES_TO_MIN_VENUE_QTY_MAX_0.30X",
    "opposite_preemption":"REC_Y_MAY_PREEMPT_OPPOSITE_X_G_ONLY" if prefix=="REC_Y" else "PROTECTED",
    "route_slots":"16","discovery_stats":{k:v for k,v in r.items() if k!="inc_keys"}}

routes=sorted(scenarios["PRICE_MODEL_10BPS"]["v12_details"]["routes"])
missing=[r for r in routes if r not in meta]
if missing: raise SystemExit("missing meta: "+repr(missing))

ledger=[]
for route in routes:
    m=meta[route]
    row={"route":route,"family":m["family"],"entry_rule_tokens":"|".join(m["entry_rule_tokens"]),
    "entry_rule_text":m["entry_rule_text"],"source_side":m["source_side"],"side_transform":m["side_transform"],
    "entry_delay_h":m["entry_delay_h"],"exit_policy":m["exit_policy"],"requested_gross_policy":m["requested_gross_policy"],
    "rank_policy":m["rank_policy"],"minlift":m["minlift"],"opposite_preemption":m["opposite_preemption"],
    "route_slots":m["route_slots"],"same_side_virtual_leg":"YES","opposite_side_policy":"EXCLUSIVE_OR_REC_Y_PREEMPT_X_G",
    "recovery_family_cap":"1.00X" if route.startswith("REC_") else "","v12_total_cap":"2.00X",
    "crypto_total_cap":"3.00X","portfolio_total_cap":"4.25X"}
    actual=by_route.get(route,[])
    if actual:
        req=[float(x.get("candidate_requested_gross",0)) for x in actual]
        row["observed_requested_gross_median_10bps"]=statistics.median(req)
        row["observed_requested_gross_min_10bps"]=min(req); row["observed_requested_gross_max_10bps"]=max(req)
        row["observed_rank_values_10bps"]="|".join(str(x) for x in sorted({t.get("rank") for t in actual}))
        row["observed_planned_exit_reasons_10bps"]="|".join(sorted({str(t.get("planned_exit_reason")) for t in actual}))
    for sid,label in [("PRICE_MODEL_10BPS","10bps"),("PRICE_MODEL_20BPS","20bps"),("PRICE_MODEL_30BPS","30bps")]:
        d=scenarios[sid]["v12_details"]["routes"].get(route)
        for key in ["trades","wins","losses","win_rate","pf_usd","net_pnl_usd","mean_net_pnl_usd"]:
            row[f"{label}_{key}"]=None if d is None else d[key]
    ledger.append(row)

csv_path=OUT/"V12_MULTILOGIC_V4_BT_LEDGER_20261009.csv"
with csv_path.open("w",newline="",encoding="utf-8-sig") as f:
    w=csv.DictWriter(f,fieldnames=list(ledger[0].keys())); w.writeheader(); w.writerows(ledger)

catalog={"status":"RESEARCH_SHADOW_CANDIDATE_NOT_ORDER_ENABLED","research_sha":"be61b258c862a180dc3385d9caabb4d99be1e942",
"preferred_case":"REF_G5_TIME48","period":"2025-08-10 through 2026-08-10","data_end_utc":"2026-08-10T23:00:00Z",
"architecture":{"same_symbol_same_side_virtual_legs":True,"opposite_side_exclusive":True,
"rec_y_preemption":"new REC_Y may close opposite REC_X/REC_G only; core/robust/Y/Z protected",
"recovery_route_slots":16,"recovery_family_gross_cap":1.0,"normal_recovery_gross":0.10,
"robust_complement_max_gross":0.25,"minlift_max_gross":0.30,"v12_total_gross_cap":2.0,
"crypto_gross_cap":3.0,"total_gross_cap":4.25,"g5_exit":"fixed 48h"},
"feature_glossary":FEATURE_GLOSSARY,"routes":ledger,
"aggregate":{sid:{"v12":scenarios[sid]["v12_details"]["all"],"portfolio":{
"final_equity_jpy":scenarios[sid]["final_equity_jpy"],"profit_factor":scenarios[sid]["profit_factor"],
"win_rate":scenarios[sid]["win_rate"],"maximum_mtm_drawdown":scenarios[sid]["maximum_mtm_drawdown"],
"closed_trades":scenarios[sid]["closed_trades"]}} for sid in scenarios}}
json_path=OUT/"V12_MULTILOGIC_V4_ROUTE_CATALOG_20261009.json"
json_path.write_text(json.dumps(catalog,ensure_ascii=False,indent=2),encoding="utf-8")

md=["# V12 Multi-Logic V4 Backtest Ledger - 2026-10-09","",
"Status: RESEARCH / SHADOW CANDIDATE. Real-order execution is not enabled by this ledger.","",
"Canonical research SHA: be61b258c862a180dc3385d9caabb4d99be1e942","",
"Preferred frozen architecture: Final1000 + G5 fixed 48h (REF_G5_TIME48).","",
"## Aggregate ledger","",
"| Cost | V12 trades | V12 WR | V12 PF | V12 net USD | Portfolio final JPY | Portfolio PF | DD |",
"|---|---:|---:|---:|---:|---:|---:|---:|"]
for sid,label in [("PRICE_MODEL_10BPS","10bps"),("PRICE_MODEL_20BPS","20bps"),("PRICE_MODEL_30BPS","30bps")]:
    sc=scenarios[sid];v=sc["v12_details"]["all"]
    md.append(f"| {label} | {v['trades']} | {v['win_rate']*100:.3f}% | {v['pf_usd']:.4f} | {v['net_pnl_usd']:.2f} | {sc['final_equity_jpy']:,.2f} | {sc['profit_factor']:.4f} | {sc['maximum_mtm_drawdown']*100:.3f}% |")
md += ["","## Route ledger","",
"| Route | Family | Entry rule | Exit | Gross | 10bps n/WR/PF | 20bps n/WR/PF | 30bps n/WR/PF |",
"|---|---|---|---|---|---|---|---|"]
def fmt(row,label):
    n=row[f"{label}_trades"]; wr=row[f"{label}_win_rate"]; pf=row[f"{label}_pf_usd"]
    pfs="INF" if pf is None and n else ("" if pf is None else f"{pf:.3f}")
    return f"{n}/{wr*100:.1f}%/{pfs}"
for row in ledger:
    md.append(f"| {row['route']} | {row['family']} | {row['entry_rule_text']} | {row['exit_policy']} | {row['requested_gross_policy']} | {fmt(row,'10bps')} | {fmt(row,'20bps')} | {fmt(row,'30bps')} |")
md += ["","## Feature glossary",""]
for k,v in FEATURE_GLOSSARY.items(): md.append(f"- {k}: {v}")
(OUT/"V12_MULTILOGIC_V4_BT_LEDGER_20261009.md").write_text("\n".join(md)+"\n",encoding="utf-8")

print("routes",len(ledger))
print(csv_path)
print(json_path)
for sid in scenarios:
    v=scenarios[sid]["v12_details"]["all"]
    print(sid,v["trades"],v["win_rate"],v["pf_usd"],v["net_pnl_usd"])
