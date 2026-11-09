#!/usr/bin/env python3
import json, math, statistics, hashlib
from pathlib import Path

# Raw-price synthetic validation for current V4/PENGU direction research.
# IMPORTANT: synthetic outcomes are adversarial logic tests, not profitability evidence.

V4_X05_VOL72_MAX = 0.00658
V4_X07_SYM3_MIN = -0.0140114167
V4_X07_BTC3_MIN = -0.0058802215
V4_X11_REL72_MIN = 0.0
PENGU_V8_PRE12_MIN = 0.0254491018
PENGU_V8_POST2_MAX = -0.0039952058

def smooth_closes(start, hours, total_return, alt_noise=0.0):
    """Generate closes from hourly log returns. alt_noise is zero-mean alternating log-return noise."""
    base = math.log1p(total_return) / hours
    rs=[]
    for i in range(hours):
        noise = alt_noise if i % 2 == 0 else -alt_noise
        rs.append(base + noise)
    # exact endpoint correction
    correction = (math.log1p(total_return) - sum(rs)) / hours
    rs=[r+correction for r in rs]
    out=[float(start)]
    for r in rs:
        out.append(out[-1]*math.exp(r))
    return out

def concat_paths(prefix, future):
    # prefix and future both include their own starting value; rescale future to prefix endpoint.
    scale=prefix[-1]/future[0]
    return prefix + [x*scale for x in future[1:]]

def ret(closes, n):
    return closes[-1] / closes[-1-n] - 1.0

def vol_log(closes, n):
    xs=closes[-(n+1):]
    lrs=[math.log(xs[i]/xs[i-1]) for i in range(1,len(xs))]
    return statistics.pstdev(lrs)

def v4_features(sym_pre, btc_pre):
    return {
        "sym_ret3": ret(sym_pre,3),
        "btc_ret3": ret(btc_pre,3),
        "sym_ret12": ret(sym_pre,12),
        "btc_ret12": ret(btc_pre,12),
        "sym_ret72": ret(sym_pre,72),
        "btc_ret72": ret(btc_pre,72),
        "rel72": ret(sym_pre,72)-ret(btc_pre,72),
        "sym_vol72": vol_log(sym_pre,72),
    }

def v4_gates(f):
    return {
        "REC_X05_TIME_36H": f["sym_vol72"] <= V4_X05_VOL72_MAX,
        "REC_X07_TIME_6H": f["sym_ret3"] > V4_X07_SYM3_MIN and f["btc_ret3"] > V4_X07_BTC3_MIN,
        "REC_X11_TIME_48H": f["rel72"] > V4_X11_REL72_MIN,
    }

def side_for_return(r):
    if r>0: return "LONG"
    if r<0: return "SHORT"
    return "FLAT"

def build_v4_scenarios():
    S=[]
    def add(name,desc,sym72,btc72,fut12,sym_noise=0,btc_noise=0, last3_override=None):
        sym=smooth_closes(100,72,sym72,sym_noise)
        btc=smooth_closes(100,72,btc72,btc_noise)
        if last3_override is not None:
            # rebuild first 69h to hit the 69h anchor, then force exact final 3h returns.
            sym_pre69=smooth_closes(100,69,sym72-last3_override[0],sym_noise)
            sym_tail=smooth_closes(sym_pre69[-1],3,last3_override[0],0)
            sym=sym_pre69+sym_tail[1:]
            btc_pre69=smooth_closes(100,69,btc72-last3_override[1],btc_noise)
            btc_tail=smooth_closes(btc_pre69[-1],3,last3_override[1],0)
            btc=btc_pre69+btc_tail[1:]
        future=smooth_closes(sym[-1],12,fut12,0)
        S.append(dict(name=name,description=desc,sym_pre=sym,btc_pre=btc,future=future,future_return12=fut12))
    add("low_vol_bull_continuation","Low-volatility rising symbol/BTC and continued rise",0.06,0.03,0.04)
    add("low_vol_bear_continuation","Low-volatility falling symbol/BTC and continued fall",-0.06,-0.03,-0.04)
    add("relative_strength_bear","Symbol falls less than BTC (positive relative strength) but symbol keeps falling",-0.02,-0.08,-0.05)
    add("mild_3h_decline_then_bear","Last 3h decline is milder than X07 cutoffs, then decline continues",-0.03,-0.02,-0.05,last3_override=(-0.010,-0.004))
    add("strong_3h_decline_then_bear","Last 3h decline exceeds X07 cutoffs and decline continues",-0.06,-0.04,-0.05,last3_override=(-0.03,-0.015))
    add("high_vol_bull_continuation","Bullish endpoint but noisy/high-vol history and continued rise",0.06,0.03,0.05,sym_noise=0.012,btc_noise=0.006)
    add("symbol_bull_btc_stronger","Symbol rises but BTC rises more; relative strength is negative",0.03,0.10,0.05)
    add("range_pre_breakdown","Near-flat low-vol prehistory then bearish future",0.001,0.001,-0.05)
    add("range_pre_breakout","Near-flat low-vol prehistory then bullish future",0.001,0.001,0.05)
    return S

def evaluate_v4():
    rows=[]
    contradictions={k:[] for k in ["REC_X05_TIME_36H","REC_X07_TIME_6H","REC_X11_TIME_48H"]}
    misses={k:[] for k in contradictions}
    for s in build_v4_scenarios():
        f=v4_features(s["sym_pre"],s["btc_pre"])
        gates=v4_gates(f)
        truth=side_for_return(s["future_return12"])
        rec={}
        for route,fire in gates.items():
            action="LONG" if fire else "SHORT"  # native V4 side under these candidate rules is SHORT
            match=(action==truth)
            rec[route]={"fire":fire,"action":action,"truth":truth,"direction_match":match}
            if fire and truth=="SHORT": contradictions[route].append(s["name"])
            if (not fire) and truth=="LONG": misses[route].append(s["name"])
        rows.append({
            "name":s["name"],"description":s["description"],"features":f,
            "future_return12":s["future_return12"],"synthetic_truth":truth,"routes":rec
        })
    return rows,contradictions,misses

def build_pengu_scenarios():
    # pre12 is the completed 12h return at entry. post2 is return from entry open to 2h completed close.
    specs=[
      ("strong_pre_up_reversal_bear", "Strong 12h rise, first 2h reverse lower, then bearish continuation", 0.04,-0.01,-0.05),
      ("strong_pre_up_dip_then_bull", "Strong 12h rise, first 2h dip, then V-shaped bullish continuation", 0.04,-0.01,0.06),
      ("strong_pre_up_continuation", "Strong 12h rise, first 2h continue higher, then bullish continuation", 0.04,0.01,0.05),
      ("weak_pre_up_reversal_bear", "Pre-rise below threshold, then sharp bearish reversal", 0.015,-0.01,-0.05),
      ("strong_pre_up_shallow_dip_bear", "Pre-rise passes but 2h dip is shallower than rescue threshold, then bear",0.04,-0.002,-0.05),
      ("strong_pre_up_exact_boundary", "Pre-rise and 2h return exactly at research thresholds",PENGU_V8_PRE12_MIN,PENGU_V8_POST2_MAX,-0.04),
      ("pre_down_bear_continuation", "Already bearish before entry; 2h down and bear continuation",-0.04,-0.01,-0.05),
      ("pre_up_reversal_flat", "Strong pre-rise and 2h drop, then flat after rescue decision",0.04,-0.01,0.0),
    ]
    out=[]
    for name,desc,pre12,post2,after6 in specs:
        pre=smooth_closes(100,12,pre12,0)
        # entry open equals final completed pre close for this synthetic harness
        entry=pre[-1]
        post=smooth_closes(entry,2,post2,0)
        after=smooth_closes(post[-1],6,after6,0)
        out.append(dict(name=name,description=desc,pre=pre,post=post,after=after,pre12=pre12,post2=post2,after6=after6))
    return out

def evaluate_pengu():
    rows=[]; contradictions=[]; misses=[]
    for s in build_pengu_scenarios():
        calc_pre=s["pre"][-1]/s["pre"][-13]-1
        calc_post=s["post"][-1]/s["post"][0]-1
        fire=(calc_pre>PENGU_V8_PRE12_MIN and calc_post<=PENGU_V8_POST2_MAX)
        # At the 2h decision point, rescue candidate changes/re-evaluates LONG toward SHORT.
        action="SHORT" if fire else "LONG"
        truth=side_for_return(s["after6"])
        match=(truth=="FLAT" or action==truth)
        if fire and truth=="LONG": contradictions.append(s["name"])
        if (not fire) and truth=="SHORT": misses.append(s["name"])
        rows.append({
          "name":s["name"],"description":s["description"],
          "calculated":{"sym_ret12":calc_pre,"p_r2":calc_post},
          "specified":{"sym_ret12":s["pre12"],"p_r2":s["post2"]},
          "after_decision_return6":s["after6"],"synthetic_truth_after_2h":truth,
          "gate_fire":fire,"action":action,"direction_match":match,
          "calc_error":{"sym_ret12":abs(calc_pre-s["pre12"]),"p_r2":abs(calc_post-s["post2"])}
        })
    return rows,contradictions,misses

def main():
    v4_rows,v4_contra,v4_miss=evaluate_v4()
    p_rows,p_contra,p_miss=evaluate_pengu()
    out={
      "schema":"disdex-raw-price-synthetic-direction-stress/v1",
      "status":"RESEARCH_ONLY_SYNTHETIC_NOT_PROFIT_EVIDENCE",
      "formulas":{
        "retN":"last_completed_close / close_N_hours_earlier - 1",
        "vol72":"population standard deviation of 72 hourly log returns",
        "V4_X05":f"sym_vol72 <= {V4_X05_VOL72_MAX}",
        "V4_X07":f"sym_ret3 > {V4_X07_SYM3_MIN} AND btc_ret3 > {V4_X07_BTC3_MIN}",
        "V4_X11":f"sym_ret72 - btc_ret72 > {V4_X11_REL72_MIN}",
        "PENGU_V8_2H":f"pre sym_ret12 > {PENGU_V8_PRE12_MIN} AND entry-to-2h-close return <= {PENGU_V8_POST2_MAX}",
      },
      "v4":{"scenarios":v4_rows,"standalone_directional_contradictions":v4_contra,"standalone_missed_corrections":v4_miss},
      "pengu_recovery_v8":{"scenarios":p_rows,"directional_contradictions":p_contra,"missed_bear_rescues":p_miss},
      "interpretation":{
        "V4_X05":"A volatility-only flip is logically ambiguous: low-vol bear and range-breakdown paths can trigger LONG.",
        "V4_X07":"The cutoffs permit mild 3h declines, so a continued-bear path can still trigger LONG.",
        "V4_X11":"Positive relative strength can coexist with negative absolute symbol trend when BTC falls faster; standalone rel72>0 can therefore trigger LONG in a falling symbol.",
        "PENGU_V8_2H":"The rule is more directionally structured because it requires a pre-rise followed by a realized 2h reversal, but a V-shaped recovery can still make a SHORT rescue wrong and threshold misses remain possible.",
        "conclusion":"Synthetic raw-price tests show whether standalone gates are logically sufficient. They do not estimate real-market false-positive rates or profitability."
      }
    }
    here=Path(__file__).resolve().parent
    rp=here.parent/"results"/"raw_price_synthetic_v4_pengu_20261110.json"
    rp.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
    md=here.parent/"RAW_PRICE_SYNTHETIC_V4_PENGU_20261110.md"
    lines=[
      "# Raw-price synthetic V4/PENGU direction stress — 2026-11-10","",
      "**Research-only adversarial logic test. This is not profitability or OOS evidence.**","",
      "The test generates raw hourly price paths, computes the same return/volatility features used by the research gates, applies each gate, and compares the resulting direction with the deliberately constructed post-entry path.","",
      "## V4 standalone-gate findings",""
    ]
    for route in v4_contra:
        lines.append(f"- {route}: directional contradictions={len(v4_contra[route])} {v4_contra[route]}; missed synthetic bullish corrections={len(v4_miss[route])} {v4_miss[route]}")
    lines += ["","Interpretation: the three simple V4 gates are **not sufficient as standalone direction classifiers**. They can still be valuable as components of a composite gate, but synthetic counterexamples exist where they flip SHORT→LONG while the constructed symbol path continues lower.","",
              "## PENGU Recovery V8 2h rescue","",
              f"- Synthetic contradictions (rescue fires but post-decision path is bullish): {len(p_contra)} {p_contra}",
              f"- Synthetic missed bearish rescues (gate does not fire but post-decision path is bearish): {len(p_miss)} {p_miss}",
              "",
              "Interpretation: V8 2h rescue has better causal structure than the simple V4 gates because it waits for an actual post-entry reversal. It is still not logically perfect: a temporary 2h dip followed by a V-shaped recovery is a counterexample, and threshold misses exist.",
              "",
              "## Required next step","",
              "- Downgrade V4 X05/X07/X11 from standalone direction rules to **component candidates** until an absolute-trend/regime confirmation removes the synthetic contradictions without damaging OOS precision.",
              "- Keep PENGU Recovery V8 2h as the strongest research candidate, but run threshold-jitter, walk-forward and V-shaped-recovery robustness before promotion.",
              "- Continue V4 Y06 separation research before moving to another strategy family.",
              ""]
    md.write_text("\n".join(lines),encoding="utf8")
    print(json.dumps({
      "v4_contradictions":{k:len(v) for k,v in v4_contra.items()},
      "v4_misses":{k:len(v) for k,v in v4_miss.items()},
      "pengu_contradictions":len(p_contra),
      "pengu_misses":len(p_miss),
      "result_sha256":hashlib.sha256(rp.read_bytes()).hexdigest()
    },ensure_ascii=False))

if __name__=="__main__":
    main()
