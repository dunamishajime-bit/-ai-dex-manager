#!/usr/bin/env python3
"""Offline, research-only V12 route audit. Does not connect to an exchange."""
from __future__ import annotations
from collections import defaultdict
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import random
import statistics

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "docs/research/results"
SOURCE = DATA / "v12-multilogic-causal-holdout-20261009"
DEST = DATA / "v12-v4-holdout-robustness-20261009"
Y06 = "REC_Y06_REV_D0_T72"
COSTS = (10, 20, 30)

def read_jsonl(p):
    with p.open(encoding="utf-8") as f:
        return [json.loads(s) for s in f if s.strip()]

def date(t, fmt):
    return datetime.fromtimestamp(t["entry_ts_ms"] / 1000, tz=timezone.utc).strftime(fmt)

def calc(rows, bps):
    v = [float(r["unit_gross_return"]) - bps / 10000 for r in rows]
    if not v:
        return dict(n=0, wr=None, pf=None, mean=None, sum=0, worst=None)
    pos = sum(x for x in v if x > 0)
    neg = -sum(x for x in v if x < 0)
    return dict(n=len(v), wr=sum(x > 0 for x in v)/len(v),
                pf=pos/neg if neg > 0 else None,
                mean=sum(v)/len(v), sum=sum(v), worst=min(v))

def bootstrap_daily_mean(rows, bps, seed=20261009, draws=3000):
    blocks = defaultdict(list)
    for t in rows:
        blocks[date(t, "%Y-%m-%d")].append(t["unit_gross_return"] - bps / 10000)
    blocks = list(blocks.values())
    n = len(blocks)
    if n < 5:
        return None
    rng = random.Random(seed)
    means = []
    for _ in range(draws):
        selected = [blocks[rng.randrange(n)] for _ in range(n)]
        means.append(sum(map(sum, selected)) / sum(map(len, selected)))
    means.sort()
    return [means[int(draws * .025)], means[int(draws * .975) - 1]]

def fmt(value, n=2):
    return "n/a" if value is None else f"{value:.{n}f}"

def main():
    trs = read_jsonl(SOURCE / "causal-trades.jsonl")
    report = json.loads((SOURCE / "causal-holdout-report.json").read_text(encoding="utf-8"))
    train = {r["route"]: r for r in json.loads((DATA / "v12-v4-priority-forward-split-20261009/training-only-priority.json").read_text(encoding="utf-8"))}
    assert len(trs) == 274 and report["status"] == "COMPLETE_CAUSAL_MULTILOGIC_EXTERNAL_HOLDOUT"
    assert report["route_rules_frozen_before_holdout_run"] and not report["production_changes"]
    assert len(set((t["route"], t["symbol"], t["side"], t["entry_ts_ms"]) for t in trs)) == 274
    routes = defaultdict(list)
    for t in trs:
        routes[t["route"]].append(t)
    assert set(routes) == set(report["by_route"])
    for bps in COSTS:
        for actual, expected in [(calc(trs, bps), report["costs"][str(bps)])] + [
            (calc(rows, bps), report["by_route"][route][str(bps)]) for route, rows in routes.items()
        ]:
            for field in ("n", "wr", "mean", "sum"):
                assert math.isclose(actual[field], expected[field], rel_tol=1e-9, abs_tol=1e-10), (bps, field)
            if actual["pf"] is not None:
                assert math.isclose(actual["pf"], expected["pf"], rel_tol=1e-9, abs_tol=1e-10), (bps, "pf")
    evidence = []
    for route, rows in sorted(routes.items(), key=lambda item: (-len(item[1]), item[0])):
        tr = train.get(route, {})
        ntr = tr.get("n_train", 0)
        m10, m30 = calc(rows, 10), calc(rows, 30)
        if m30["n"] >= 10 and m30["pf"] is not None and m30["pf"] < 1:
            flag = "NEGATIVE_EXTERNAL"
        elif ntr < 20:
            flag = "INSUFFICIENT_TRAIN"
        elif tr.get("train_pf30", 0) <= 1:
            flag = "WEAK_TRAIN"
        else:
            flag = "NEEDS_UNSEEN_FORWARD"
        evidence.append({
            "route": route, "train_n": ntr, "train_pf30": tr.get("train_pf30"),
            "external": {str(b): calc(rows, b) for b in COSTS},
            "external_entry_days": len({date(t,"%Y-%m-%d") for t in rows}),
            "day_cluster_mean_ci10": bootstrap_daily_mean(rows, 10, seed=len(rows)+451),
            "diagnostic_not_trading_flag": flag
        })
    y = sorted(routes[Y06], key=lambda t: (t["entry_ts_ms"], t["symbol"]))
    monthly = {month: calc([t for t in y if date(t, "%Y-%m") == month], 10)
               for month in sorted({date(t, "%Y-%m") for t in y})}
    symbols = {symbol: calc([t for t in y if t["symbol"] == symbol], 10)
               for symbol in sorted({t["symbol"] for t in y})}
    run = longest = 0
    for t in y:
        run = run + 1 if t["unit_gross_return"] - .001 < 0 else 0
        longest = max(longest, run)
    features = read_jsonl(SOURCE / "causal-features.jsonl")
    fmap = defaultdict(list)
    for f in features:
        fmap[(f["symbol"], f["side"], f["entry_ts_ms"])].append(f)
    attached = [(t, fmap[(t["symbol"], t["side"], t["entry_ts_ms"])][0])
                for t in y if len(fmap[(t["symbol"], t["side"], t["entry_ts_ms"])]) == 1]
    medians = {}
    for fld in ("btc6", "btc24", "btc48", "rel24", "vol_ratio", "er24", "sret24"):
        medians[fld] = {}
        for name, positive in (("wins", True), ("losses", False)):
            v = [float(f[fld]) for t, f in attached if (t["unit_gross_return"]-.001 > 0) == positive
                 and isinstance(f.get(fld), (float, int)) and math.isfinite(f[fld])]
            medians[fld][name] = {"n": len(v), "median": statistics.median(v) if v else None}
    result = {
        "status": "RESEARCH_ONLY_BLOCKED_PRODUCTION",
        "source_parity": "PASS_274_ENTRIES_ALL_ROUTES_10_20_30_BPS",
        "basis": "Frozen V4, H1 route-only before ownership, min-size, gross & venue modeling",
        "all_routes": {str(b): calc(trs,b) for b in COSTS},
        "without_y06_route_only": {str(b): calc([t for t in trs if t["route"]!=Y06],b) for b in COSTS},
        "by_route": evidence,
        "y06": {
            "trades": len(y), "distinct_entry_days": len({date(t,"%Y-%m-%d") for t in y}),
            "maximum_consecutive_losing_route_events": longest,
            "monthly_10bps": monthly, "symbol_10bps": symbols,
            "daily_cluster_bootstrap_mean10_95": bootstrap_daily_mean(y,10),
            "causal_feature_matched": len(attached),
            "posthoc_feature_medians_no_gate": medians,
        },
        "caveats": [
            "Aug-Oct had been inspected before by prior V12 work: not pristine unseen data.",
            "Train-only ranking is partially in-sample because route repairs were selected using development period.",
            "External frozen V4 and second-pass repair routes differ, so no experimental risk reallocation is certified.",
            "Without-Y06 route-only sum is NOT a portfolio PnL, no ownership, margin, funding or DD.",
            "Day-block bootstrap is descriptive; overlapping H1 trades and regime changes invalidate IID inference.",
            "Do not use posthoc route/symbol/BTC/month grouping as a live gate; no automated production changes."
        ]
    }
    DEST.mkdir(parents=True, exist_ok=True)
    (DEST / "audit.json").write_text(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False)+"\n",encoding="utf-8")
    md = [
        "# V12 V4 — forward robustness / route-risk audit (2026-10-09)",
        "",
        "**RESEARCH ONLY; production deployment BLOCKED. No runner, HP, Gross or LIVE changes.**",
        "",
        "Input: Aug 11–Oct 4, 2026 H1 route-only external replay, frozen V4 rules.",
        "**Parity PASS**: 274 trades, 10/20/30bps, total plus 23 per-route results agree with source manifest.",
        "Costs are modeled round-trip basis points off entry notional; not exchange-fills or a full-portfolio replay.",
        "",
        "## Development training vs separate external route study",
        "| Route | Train n | Train PF (30bps) | External n | 10bps WR | 10bps PF | 30bps PF | Flag |",
        "|---|---:|---:|---:|---:|---:|---:|---|"
    ]
    for r in evidence:
        m10,m30 = r["external"]["10"],r["external"]["30"]
        md.append(f"| {r['route']} | {r['train_n']} | {fmt(r['train_pf30'])} | {m10['n']} | {fmt(100*m10['wr'],1)}% | {fmt(m10['pf'])} | {fmt(m30['pf'])} | {r['diagnostic_not_trading_flag']} |")
    md += [
        "",
        "Flags are diagnostic; they are NOT a newly optimized priority ranking.",
        "X09: train PF30 below 1 despite external PF above 3; X14: only 2 train examples.",
        "X10: 11 train and 14 external samples, insufficient for larger risk.",
        "",
        "## Y06 by month — 10bps external, route-only",
        f"Total {len(y)} route trades on {result['y06']['distinct_entry_days']} entry days; longest event-sequence losing streak {longest}.",
        "| UTC month | Trades | WR | PF | Mean net/notional |",
        "|---|---:|---:|---:|---:|"
    ]
    for mo, m in monthly.items():
        md.append(f"| {mo} | {m['n']} | {fmt(100*m['wr'],1)}% | {fmt(m['pf'])} | {fmt(100*m['mean'])}% |")
    ci = result["y06"]["daily_cluster_bootstrap_mean10_95"]
    md += ["", f"Descriptive UTC-day block bootstrap 95% mean interval: {fmt(100*ci[0])}% to {fmt(100*ci[1])}% per notional.",
           "This is NOT a prospective confidence guarantee, trade-day independence is unproven.",
           "", "## Y06 by symbol — purely descriptive; no hindsight veto",
           "| Symbol | n | 10bps WR | PF | Mean net/notional |",
           "|---|---:|---:|---:|---:|"]
    for symbol,m in sorted(symbols.items(), key=lambda item: -item[1]["n"]):
        md.append(f"| {symbol} | {m['n']} | {fmt(100*m['wr'],1)}% | {fmt(m['pf'])} | {fmt(100*m['mean'])}% |")
    md += [
        "", "## Decision / next mandatory verification",
        "1. BLOCK Y06 priority and Gross increase: August and September external route-edge are negative.",
        "2. Neither strong-looking external X09 nor X14 is allowed to replace Y06 in LIVE based on this study.",
        "3. Keep current live unchanged. Treat Y06 no-new-entry as a research/shadow hypothesis only.",
        "4. Freeze any new causal rules BEFORE collecting genuinely new forward samples; no posthoc symbol/BTC filters.",
        "5. Build external H1 portfolio replay with PENGU/Q102/FET/V52/HYPE/IDLE, venue quantities, funding, actual ownership, Gross reservations and daily DD governor.",
        "6. Recheck full monthly and 10/20/30bps portfolio MTM DD <=20% under independent time/regime evidence before proposing activation.",
        "7. Preserve original 170 vs 115 Y06 fill-level ledgers, and leave original repo and every LIVE runner alone.",
        "", "Machine-readable evidence: audit.json", ""
    ]
    (DEST / "AUDIT.md").write_text("\n".join(md),encoding="utf-8")
    print("PASS_274_ENTRIES_ALL_ROUTES_10_20_30_BPS")
    print("Y06",result["y06"]["trades"],"days",result["y06"]["distinct_entry_days"],"max consecutive losses",longest,"CI",ci)
    print("All external 10bps",result["all_routes"]["10"])
    print("Without Y06 10bps ROUTE ONLY",result["without_y06_route_only"]["10"])
    print("files", DEST)

if __name__ == "__main__":
    main()
