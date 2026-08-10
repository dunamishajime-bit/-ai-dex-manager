from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier

import run_early_wave_proxy as base
import run_wave_state_proxy as ws
import run_mtf_wave_proxy as mtf

OUT_DIR = Path("research/aifx_early_wave")
DIRECTIONS = ("LONG", "SHORT")
FEATURES = [
    "ret1_atr", "ret2_atr", "ret4_atr", "ret8_atr", "body_signed", "body_frac", "close_loc",
    "atr_ratio", "channel_pos16", "eff12", "eff16", "disp4", "disp12", "disp16",
    "posfrac8", "negfrac8", "m30_disp4", "m30_disp12", "m30_eff12", "h1_disp8",
]
THRESHOLDS = (0.55, 0.60, 0.65, 0.70, 0.75)
LABEL_HORIZON = 32       # 8h future window, training label only.
LABEL_MFE_ATR = 2.5
LABEL_MAE_ATR = 1.5
STOP_ATR = 1.5
TRAIL_ACTIVATE_R = 1.0
TRAIL_ATR = 2.75
MAX_HOLD_BARS = 192
EXIT_PROB = 0.35


def prepare(pair: str) -> pd.DataFrame:
    x = mtf.add_mtf(base.load_pair(pair))
    x["body_signed"] = x.body / x.atr.replace(0, np.nan)
    return x


def labels(x: pd.DataFrame, direction: str) -> np.ndarray:
    c = x.mid_close.to_numpy(dtype=float)
    atr = x.atr.to_numpy(dtype=float)
    hi = x.mid_high.to_numpy(dtype=float)
    lo = x.mid_low.to_numpy(dtype=float)
    n = len(x)
    out = np.zeros(n, dtype=np.int8)
    side = 1 if direction == "LONG" else -1
    for i in range(n - LABEL_HORIZON - 1):
        a = atr[i]
        if not np.isfinite(a) or a <= 0:
            continue
        sl = slice(i + 1, i + 1 + LABEL_HORIZON)
        if side == 1:
            mfe = (np.nanmax(hi[sl]) - c[i]) / a
            mae = (c[i] - np.nanmin(lo[sl])) / a
        else:
            mfe = (c[i] - np.nanmin(lo[sl])) / a
            mae = (np.nanmax(hi[sl]) - c[i]) / a
        out[i] = int(mfe >= LABEL_MFE_ATR and mae <= LABEL_MAE_ATR)
    return out


def matrix(x: pd.DataFrame) -> np.ndarray:
    return x[FEATURES].replace([np.inf, -np.inf], np.nan).to_numpy(dtype=float)


def fit_model(X: np.ndarray, y: np.ndarray, mask: np.ndarray) -> HistGradientBoostingClassifier:
    good = mask & np.isfinite(X).all(axis=1)
    Xg = X[good]; yg = y[good]
    if len(np.unique(yg)) < 2:
        raise RuntimeError("single-class training target")
    pos = max(1, int((yg == 1).sum())); neg = max(1, int((yg == 0).sum()))
    w = np.where(yg == 1, neg / pos, 1.0)
    model = HistGradientBoostingClassifier(
        learning_rate=0.05, max_iter=120, max_leaf_nodes=15,
        min_samples_leaf=100, l2_regularization=2.0,
        early_stopping=False, random_state=20260810,
    )
    model.fit(Xg, yg, sample_weight=w)
    return model


def predict(model, X: np.ndarray) -> np.ndarray:
    p = np.zeros(len(X), dtype=float)
    good = np.isfinite(X).all(axis=1)
    p[good] = model.predict_proba(X[good])[:, 1]
    return p


def entry_from_prob(p: np.ndarray, threshold: float) -> np.ndarray:
    high = p >= threshold
    prev = np.r_[False, high[:-1]]
    return high & ~prev


def exit_from_prob(p: np.ndarray) -> np.ndarray:
    return p <= EXIT_PROB


def simulate(x, entry, exit_sig, pair, direction, start, end):
    old = (ws.STOP_ATR, ws.TRAIL_ACTIVATE_R, ws.TRAIL_ATR, ws.MAX_HOLD_BARS)
    ws.STOP_ATR, ws.TRAIL_ACTIVATE_R, ws.TRAIL_ATR, ws.MAX_HOLD_BARS = STOP_ATR, TRAIL_ACTIVATE_R, TRAIL_ATR, MAX_HOLD_BARS
    try:
        return ws.simulate(x, entry, exit_sig, pair, "PAIR_WAVE_CLASSIFIER", direction, start, end)
    finally:
        ws.STOP_ATR, ws.TRAIL_ACTIVATE_R, ws.TRAIL_ATR, ws.MAX_HOLD_BARS = old


def yrmask(x: pd.DataFrame, start_year: int, end_year_exclusive: int, label_safe: bool = False) -> np.ndarray:
    start = pd.Timestamp(f"{start_year}-01-01", tz="UTC")
    end = pd.Timestamp(f"{end_year_exclusive}-01-01", tz="UTC")
    if label_safe:
        end -= pd.Timedelta(minutes=15 * LABEL_HORIZON)
    return ((x.index >= start) & (x.index < end)).to_numpy()


def evaluate_threshold(x, p, pair, direction, threshold, years):
    e = entry_from_prob(p, threshold); z = exit_from_prob(p)
    rows=[]; by={}
    for y in years:
        s,t=base.year_range(y); r=simulate(x,e,z,pair,direction,s,t); by[str(y)]=base.metrics(r); rows.extend(r)
    return base.metrics(rows), by, rows, e


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    frames = {p: prepare(p) for p in base.PAIRS}
    common=set(base.complete_years(frames[base.PAIRS[0]]))
    for p in base.PAIRS[1:]: common &= set(base.complete_years(frames[p]))
    years=sorted(common)
    # 2013-15 model train, 2016-17 Development selection, 2018-19 Validation, 2020-21 untouched OOS.
    train_years=years[:-6]; dev_years=years[-6:-4]; val_years=years[-4:-2]; oos_years=years[-2:]
    if len(train_years) < 3 or len(dev_years)!=2 or len(val_years)!=2 or len(oos_years)!=2:
        raise RuntimeError(years)
    result={
        "status":"PAIR_WAVE_CLASSIFIER_PROXY", "source_timezone_verified":False,
        "formal_production_evidence":False, "session_rules_used":False,
        "cost_stress":"2x configured proxy spread floor + execution buffer",
        "selection_uses_oos":False, "features":FEATURES, "threshold_candidates":list(THRESHOLDS),
        "label":{"horizon_bars":LABEL_HORIZON,"mfe_atr":LABEL_MFE_ATR,"max_mae_atr":LABEL_MAE_ATR},
        "execution":{"stop_atr":STOP_ATR,"trail_activate_r":TRAIL_ACTIVATE_R,"trail_atr":TRAIL_ATR,
                     "max_hold_bars":MAX_HOLD_BARS,"exit_probability":EXIT_PROB},
        "train_years":train_years,"development_years":dev_years,"validation_years":val_years,"oos_years":oos_years,
        "directions":{}
    }
    passed=[]; passed_rows=[]
    train_start=min(train_years); train_end=max(train_years)+1
    full_dev_end=max(dev_years)+1; full_val_end=max(val_years)+1

    for pair in base.PAIRS:
        x=frames[pair]; X=matrix(x)
        for direction in DIRECTIONS:
            key=f"{pair}:{direction}"; y=labels(x,direction)
            train_mask=yrmask(x,train_start,train_end,label_safe=True)
            model=fit_model(X,y,train_mask); p= predict(model,X)
            candidates=[]
            for th in THRESHOLDS:
                dm,db,rows,e=evaluate_threshold(x,p,pair,direction,th,dev_years)
                pos=sum(db[str(yy)]["net_r"]>0 for yy in dev_years)
                candidates.append({"threshold":th,"metrics":dm,"by_year":db,"positive_years":pos})
            candidates.sort(key=lambda a:(a["positive_years"], min(a["by_year"][str(yy)]["net_r"] for yy in dev_years), a["metrics"]["net_r"], a["metrics"]["pf"]), reverse=True)
            chosen=candidates[0]; th=float(chosen["threshold"]); dm=chosen["metrics"]; db=chosen["by_year"]
            dg=(chosen["positive_years"]==2 and dm["trades"]>=40 and dm["net_r"]>0 and dm["pf"]>=1.05)

            vm=base.metrics([]); vb={}; vg=False; om=base.metrics([]); ob={}; diag={}; op=False
            if dg:
                # threshold and model specification are frozen. Refit using all pre-validation years only.
                pre_val_mask=yrmask(x,train_start,full_dev_end,label_safe=True)
                model_val=fit_model(X,y,pre_val_mask); p_val=predict(model_val,X)
                vm,vb,_,_=evaluate_threshold(x,p_val,pair,direction,th,val_years)
                vg=(all(vb[str(yy)]["net_r"]>0 for yy in val_years) and vm["trades"]>=40 and vm["pf"]>=1.05)
                if vg:
                    # Standard walk-forward refit: Validation outcomes do not alter parameters, only enlarge training history.
                    pre_oos_mask=yrmask(x,train_start,full_val_end,label_safe=True)
                    model_oos=fit_model(X,y,pre_oos_mask); p_oos=predict(model_oos,X)
                    om,ob,oos_rows,e_oos=evaluate_threshold(x,p_oos,pair,direction,th,oos_years)
                    for yy in oos_years:
                        yr_rows=[]
                        s=pd.Timestamp(f"{yy}-01-01",tz="UTC"); t=pd.Timestamp(f"{yy+1}-01-01",tz="UTC")
                        for r in oos_rows:
                            et=pd.Timestamp(r["entry_time"])
                            if s<=et<t: yr_rows.append(r)
                        diag[str(yy)]=base.wave_diagnostics(x,e_oos,direction,yy,pair,yr_rows)
                    op=(all(ob[str(yy)]["net_r"]>0 for yy in oos_years) and om["pf"]>=1.05)
                    if op: passed.append(key); passed_rows.extend(oos_rows)
            result["directions"][key]={
                "pair":pair,"direction":direction,"selected_threshold":th,
                "development_candidates":[{"threshold":a["threshold"],"metrics":a["metrics"],"positive_years":a["positive_years"]} for a in candidates],
                "development":dm,"development_by_year":db,"development_gate":dg,
                "validation":vm,"validation_by_year":vb,"validation_gate":vg,
                "oos":om,"oos_by_year":ob,"oos_wave_diagnostics":diag,"oos_pass":op,
                "train_positive_rate":float(y[train_mask].mean()),
            }
    result["development_passed"]=[k for k,v in result["directions"].items() if v["development_gate"]]
    result["validation_passed"]=[k for k,v in result["directions"].items() if v["validation_gate"]]
    result["oos_passed"]=passed; result["oos_passed_portfolio_unconstrained_sum"]=base.metrics(passed_rows)
    result["status"]="PROXY_PROMISING" if passed else "PROXY_REJECT"
    (OUT_DIR/"pair_wave_classifier_results.json").write_text(json.dumps(result,indent=2),encoding="utf-8")
    lines=["# AIFX Pair-Direction Wave Classifier Proxy","",f"Status: **{result['status']}**","",
           f"Train: {train_years}",f"Development: {dev_years}",f"Validation: {val_years}",f"OOS: {oos_years}","",
           "## Development-pass"]
    if result["development_passed"]:
        for k in result["development_passed"]:
            v=result["directions"][k]; lines.append(f"- {k}: th={v['selected_threshold']:.2f}, Dev {v['development']['net_r']:.2f}R PF {v['development']['pf']:.3f}; Val {v['validation']['net_r']:.2f}R PF {v['validation']['pf']:.3f}; ValPass={v['validation_gate']}")
    else: lines.append("- none")
    lines += ["", "## Validation-pass"]
    if result["validation_passed"]:
        for k in result["validation_passed"]:
            v=result["directions"][k]; lines.append(f"- {k}: OOS {v['oos']['net_r']:.2f}R PF {v['oos']['pf']:.3f} DD {v['oos']['max_dd_r']:.2f} Trades {v['oos']['trades']} Pass={v['oos_pass']}")
    else: lines.append("- none")
    lines += ["", "## OOS-pass", "- "+(", ".join(passed) if passed else "none")]
    (OUT_DIR/"pair_wave_classifier_summary.md").write_text("\n".join(lines)+"\n",encoding="utf-8")
    print(json.dumps({"status":result["status"],"dev_pass":result["development_passed"],"val_pass":result["validation_passed"],"oos_pass":passed},indent=2))

if __name__=="__main__": main()
