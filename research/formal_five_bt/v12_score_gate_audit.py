"""Read-only V12 pre-entry Score/Volume eligibility audit, backed by exact Aster scan.
No counterfactual fill or portfolio outcome is inferred from pre-WR eligibility."""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
import json, math
from pathlib import Path

HOUR = 3_600_000
H2 = 2 * HOUR
SCORE_BASE = 1.4649
VOL_BASE = .9845
SCORE_CASES = (
    ("SOURCE_BASELINE", SCORE_BASE, VOL_BASE),
    ("SCORE_1P20", 1.20, VOL_BASE),
    ("SCORE_1P00", 1.00, VOL_BASE),
    ("SCORE_0P85", .85, VOL_BASE),
    ("VOLUME_0P80", SCORE_BASE, .80),
    ("VOLUME_0P55", SCORE_BASE, .55),
    ("SCORE_1P00_VOLUME_0P80", 1.0, .80),
    ("SCORE_0P85_VOLUME_0P55", .85, .55),
)

def read_rows(path):
    with Path(path).open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)

def utc_day(ts):
    return datetime.fromtimestamp(ts / 1000, timezone.utc).strftime("%Y-%m-%d")

def market_maps(root, names):
    h2_close = {}
    h1_last_close = {}
    for sym in sorted(set(names)|{"BTCUSDT"}):
        f = root / "normalized/aster/klines" / (sym + ".jsonl")
        rows = list(read_rows(f))
        by_time = {int(r["event_time_ms"]): r for r in rows}
        close = {}
        for t, first in by_time.items():
            if t % H2 == 0 and t + HOUR in by_time:
                second = by_time[t + HOUR]
                close[t + H2] = float(second["close"])
        h2_close[sym] = close
        h1_last_close[sym] = {int(r["event_time_ms"])+HOUR:float(r["close"]) for r in rows}
    timestamps = sorted(h2_close["BTCUSDT"])
    strong = {}
    for i, t in enumerate(timestamps):
        if i < 52 or any(timestamps[k+1] - timestamps[k] != H2 for k in range(i-52, i)):
            continue
        avg = sum(h2_close["BTCUSDT"][t0] for t0 in timestamps[i-52:i+1]) / 53
        strong[t] = h2_close["BTCUSDT"][t]/avg - 1
    return h2_close, h1_last_close, strong

def evaluate(c, regime, strong_distance, close, score_gate, vol_gate):
    score = float(c["score"])
    volume = float(c["volumeRatio"])
    momentum = float(c["momentum"])
    atr = float(c["atr"])
    if not all(map(math.isfinite, [score,volume,momentum,atr,close,strong_distance])):
        return "FEATURES_MISSING"
    if volume < vol_gate:
        return "VOLUME_RATIO_BELOW_MINIMUM"
    if abs(momentum) < 6.0879 * .001:
        return "EDGE_TO_COST_BELOW_MINIMUM"
    if abs(momentum) < .0227:
        return "DIRECTIONAL_MOMENTUM_BELOW_MINIMUM"
    side = c["side"]
    if regime == "LONG" and side != "LONG" or regime == "SHORT" and side != "SHORT":
        return "BTC_DIRECTION_MISMATCH"
    if regime == "NEUTRAL":
        return "PASS" if score >= score_gate else "SCORE_QUALITY_GATE"
    if score >= score_gate:
        return "PASS"
    strong = regime == "LONG" and strong_distance >= .0359 or regime == "SHORT" and strong_distance <= -.0359
    atr_ratio = atr/close
    if strong:
        return "PASS" if .15 <= score <= .70 and atr_ratio >= .014 else "SCORE_QUALITY_GATE"
    aligned = momentum if side == "LONG" else -momentum
    return "PASS" if aligned >= .054 and atr_ratio >= .014 else "MOMENTUM_ATR_OR_SCORE_QUALITY_GATE"

def day_streak(days, nonzero):
    max_streak=0; current=0; start=None; max_period=None
    for day in days:
        if day in nonzero:
            current=0;start=None
        else:
            if current == 0: start=day
            current+=1
            if current>max_streak:
                max_streak=current;max_period=[start,day]
    return max_streak,max_period

def analyze(root, scan, period_start, period_end_exclusive, output, portfolio_trades=None):
    raw=list(read_rows(Path(scan)/"decisions/V12.jsonl"))
    syms=sorted({str(r["symbol"]) for r in raw})
    h2_closes, _, strong = market_maps(Path(root), syms)
    bt_start=datetime.fromisoformat(period_start).replace(tzinfo=timezone.utc).date()
    bt_end=datetime.fromisoformat(period_end_exclusive).replace(tzinfo=timezone.utc).date()
    days=[(bt_start+timedelta(days=i)).isoformat() for i in range((bt_end-bt_start).days)]
    events=defaultdict(list)
    original=Counter();baseline_mismatches=[]
    original_by_day=Counter(); month_original=Counter()
    for row in raw:
        timestamp=int(row["reference_ts_ms"]) if row.get("reference_ts_ms") else int(row["decision_ts_ms"])
        events[timestamp].append(row)
        status=row.get("status")
        original[status]+=1
        if status=="SIGNAL":
            day=utc_day(timestamp);original_by_day[day]+=1;month_original[day[:7]]+=1
    result={"status":"PRE_WINRATE_GATE_AUDIT_NOT_A_COUNTERFACTUAL_BT",
        "source_venue":"ASTER_ONLY","period":[period_start,period_end_exclusive],
        "raw_decision_rows":len(raw),"original_status_counts":dict(original),
        "source_original_signals_by_month":dict(sorted(month_original.items())),
        "source_original_daily_count":{"days_with_signals":sum(original_by_day[d]>0 for d in days),
            "days_without_signals":sum(original_by_day[d]==0 for d in days),
            "longest_zero_signal_streak_days":day_streak(days,original_by_day)[0],
            "longest_zero_signal_period":day_streak(days,original_by_day)[1]},
        "cases":{}}
    for name,score,volume in SCORE_CASES:
        reasons=Counter();regimes=Counter();candidate_newly_eligible=0;candidate_baseline_eligible=0
        signal_pre_wr_by_day=Counter();month_pre_wr=Counter()
        pre_wr_slots=0; original_signal_same_slot=0;observed_raw=0;no_btc_sma=0
        for ts, rows in sorted(events.items()):
            regime=str(rows[0].get("btc_regime") or "UNKNOWN")
            regimes[regime]+=1
            if ts not in strong:
                no_btc_sma += 1
                continue
            eligible=[]
            for row in rows:
                c=row.get("candidate")
                if not c: continue
                observed_raw+=1
                sym=str(row["symbol"])
                close=h2_closes.get(sym,{}).get(ts)
                if close is None or not math.isfinite(close) or close <= 0:
                    reasons["SYMBOL_H2_CLOSE_MISSING"]+=1;continue
                verdict=evaluate(c,regime,strong[ts],close,score,volume)
                reasons[verdict]+=1
                if verdict!="PASS":continue
                eligible.append((float(c["score"]),sym,row))
                if row.get("portfolio_rank") or row.get("status")=="SIGNAL":
                    candidate_baseline_eligible+=1
                if row.get("status")!="SIGNAL" and row.get("candidate",{}).get("signalReason") != "SIGNAL_ELIGIBLE":
                    candidate_newly_eligible+=1
            eligible.sort(key=lambda x:(-x[0],x[1]))
            chosen=eligible[:2]
            third=next((x for x in eligible[2:] if x[0]>=.7),None)
            if third:chosen.append(third)
            count=len(chosen)
            pre_wr_slots+=count
            if count:
                day=utc_day(ts);signal_pre_wr_by_day[day]+=count;month_pre_wr[day[:7]]+=count
        zero_days=sum(signal_pre_wr_by_day[d]==0 for d in days)
        result["cases"][name]={"score_threshold":score,"volume_threshold":volume,
            "candidate_first_reject_or_pass_counts":dict(reasons),"raw_candidates_evaluated":observed_raw,
            "pre_winrate_candidate_pass_count":reasons["PASS"],"pre_winrate_top3_slot_count":pre_wr_slots,
            "pre_winrate_monthly_slot_counts":dict(sorted(month_pre_wr.items())),
            "pre_winrate_dry_days":zero_days,"pre_winrate_longest_dry_streak_days":day_streak(days,signal_pre_wr_by_day)[0],
            "days_without_original_signals":sum(original_by_day[d]==0 for d in days),
            "btc_regime_timestamp_counts":dict(regimes),"timestamps_without_complete_btc_53bar_sma":no_btc_sma}
    # For all variants, count the *original* accepted portfolio fills separately from
    # pre-WR candidates. A hypothetical pass here is NOT necessarily an order.
    if portfolio_trades:
        trades=list(read_rows(portfolio_trades))
        v12=[t for t in trades if t.get("strategy_id")=="V12"]
        tradedays=Counter(utc_day(int(t["entry_ts_ms"])) for t in v12)
        result["portfolio_v12_fills"]={"count":len(v12),
            "days_without_fills":sum(tradedays[d]==0 for d in days),
            "longest_no_fill_streak_days":day_streak(days,tradedays)[0],
            "longest_no_fill_period":day_streak(days,tradedays)[1],
            "fills_by_month":dict(sorted(Counter(d[:7] for d in tradedays.elements()).items()))}
    Path(output).parent.mkdir(parents=True,exist_ok=True)
    Path(output).write_text(json.dumps(result,sort_keys=True,indent=2,allow_nan=False)+"\n")
    print("V12_GATE_AUDIT",json.dumps({k:result[k] for k in ("period","source_original_daily_count","portfolio_v12_fills") if k in result},sort_keys=True),flush=True)
    for name,case in result["cases"].items():
        print("V12_GATE_CASE",name,json.dumps({k:case[k] for k in
            ("pre_winrate_candidate_pass_count","pre_winrate_top3_slot_count","pre_winrate_dry_days","pre_winrate_longest_dry_streak_days","candidate_first_reject_or_pass_counts")},sort_keys=True),flush=True)
    return result

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--root",type=Path,required=True)
    p.add_argument("--scan",type=Path,required=True)
    p.add_argument("--period-start",required=True)
    p.add_argument("--period-end-exclusive",required=True)
    p.add_argument("--output",type=Path,required=True)
    p.add_argument("--portfolio-trades",type=Path)
    a=p.parse_args()
    analyze(a.root,a.scan,a.period_start,a.period_end_exclusive,a.output,a.portfolio_trades)
if __name__=="__main__":
    main()
