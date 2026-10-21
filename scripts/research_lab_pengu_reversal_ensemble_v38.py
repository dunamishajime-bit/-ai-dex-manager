from __future__ import annotations

import datetime as dt
import json
import os
from dataclasses import asdict
from pathlib import Path
from typing import List

import research_lab_pengu_adaptive_72h_v36 as v36


def ensemble_configs():
    result = {}
    for threshold in [30.0, 35.0]:
        for btc_filter in ["NONE", "RISK"]:
            rules = [v36.Config("REVERSAL", 14, slow, threshold, 0.0, btc_filter) for slow in [72, 120, 168]]
            name = f"REVERSAL_ENSEMBLE_RSI14_T{int(threshold)}_B{btc_filter}_H72"
            result[name] = rules
    return result


def build_ensemble_trades(rules, pengu, btc, funding):
    p_index = {int(row["ts"]): index for index, row in enumerate(pengu)}
    b_index = {int(row["ts"]): index for index, row in enumerate(btc)}
    common = sorted(set(p_index) & set(b_index))
    trades: List[v36.Trade] = []
    next_free = 0
    for ts in common:
        if ts < next_free or (ts // v36.HOUR) % v36.DECISION_HOURS != 0:
            continue
        pi, bi = p_index[ts], b_index[ts]
        votes = [v36.signal(rule, pengu, pi, btc, bi) for rule in rules]
        long_votes = sum(value > 0 for value in votes)
        short_votes = sum(value < 0 for value in votes)
        side = 1 if long_votes >= 2 else -1 if short_votes >= 2 else 0
        if side == 0:
            continue
        entry_index = pi + 1
        exit_index = entry_index + v36.HOLD_HOURS
        if exit_index >= len(pengu):
            continue
        entry = pengu[entry_index]
        exit_row = pengu[exit_index]
        entry_ts = int(entry["ts"])
        exit_ts = int(exit_row["ts"])
        if exit_ts - entry_ts != v36.HOLD_HOURS * v36.HOUR:
            continue
        entry_price = float(entry["open"])
        exit_price = float(exit_row["open"])
        gross = side * (exit_price / entry_price - 1.0) * 100.0
        paid_funding = side * v36.funding_between(funding, entry_ts, exit_ts)
        base = gross - paid_funding - 0.12 - 0.02 * (v36.HOLD_HOURS / 24.0)
        severe = gross - paid_funding - 0.20 - 0.05 * (v36.HOLD_HOURS / 24.0)
        trades.append(v36.Trade(entry_ts, exit_ts, side, entry_price, exit_price, gross, paid_funding, base, severe))
        next_free = exit_ts
    return trades


def main():
    end = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000) // v36.HOUR * v36.HOUR
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    pengu = v36.fetch_klines("PENGUUSDT", end)
    btc = v36.fetch_klines("BTCUSDT", end)
    funding = v36.fetch_funding("PENGUUSDT", end)
    first = max(int(pengu[0]["ts"]), int(btc[0]["ts"])) + 360 * v36.HOUR
    last = min(int(pengu[-1]["ts"]), int(btc[-1]["ts"]))
    span = last - first
    dev_end = first + int(span * 0.50)
    validation_end = first + int(span * 0.75)

    results = {}
    passed = []
    for name, rules in ensemble_configs().items():
        trades = build_ensemble_trades(rules, pengu, btc, funding)
        dev = v36.metrics(trades, first, dev_end)
        validation = v36.metrics(trades, dev_end, validation_end)
        holdout = v36.metrics(trades, validation_end, last + v36.HOUR)
        item = {
            "rules": [asdict(rule) for rule in rules],
            "development": dev,
            "validation": validation,
            "frozenHoldout": holdout,
            "allTrades": [asdict(trade) for trade in trades],
        }
        results[name] = item
        if (
            dev["trades"] >= 10 and dev["compoundedReturnPct"] > 0 and (dev["profitFactor"] or 0) >= 1.20
            and dev["maxDrawdownPct"] >= -35 and dev["severeReturnPct"] > 0 and (dev["severeProfitFactor"] or 0) >= 1.05
            and validation["trades"] >= 5 and validation["compoundedReturnPct"] > 0 and (validation["profitFactor"] or 0) >= 1.05
            and validation["maxDrawdownPct"] >= -25 and validation["severeReturnPct"] > 0
            and holdout["trades"] >= 5 and holdout["compoundedReturnPct"] > 0 and (holdout["profitFactor"] or 0) >= 1.0
            and holdout["maxDrawdownPct"] >= -25 and holdout["severeReturnPct"] > 0 and (holdout["severeProfitFactor"] or 0) >= 1.0
        ):
            passed.append(name)
    passed.sort(key=lambda name: (
        results[name]["frozenHoldout"]["severeReturnPct"],
        results[name]["validation"]["severeReturnPct"],
        results[name]["development"]["severeReturnPct"],
    ), reverse=True)
    selected = passed[0] if passed else None
    status = "PENGU_REVERSAL_ENSEMBLE_FROZEN_CANDIDATE" if selected else "NO_ROBUST_PENGU_REVERSAL_ENSEMBLE"
    payload = v36.rounded({
        "version": 38,
        "strategyId": "PENGU_REVERSAL_ENSEMBLE_V38",
        "status": status,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "selected": selected,
        "passed": passed,
        "results": results,
        "productionChanged": False,
        "realTradingEnabled": False,
        "limitations": [
            "The ensemble family was chosen after V36 validation inspection, so the frozen holdout is the decisive one-time test.",
            "Three fixed RSI14 reversal rules vote across SMA72/120/168; two matching votes are required.",
            "A separate integrated portfolio audit is required before production use.",
        ],
    })
    report = [
        "# PENGU Reversal Ensemble V38", "",
        f"- Status: **{status}**", f"- Selected: **{selected or 'NONE'}**", f"- Passed: {len(passed)}", "",
        "| Ensemble | Dev return | Dev PF | Dev DD | Val return | Val PF | Holdout N | Holdout return | Holdout PF | Holdout severe | Holdout DD |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for name, item in payload["results"].items():
        dev, val, hold = item["development"], item["validation"], item["frozenHoldout"]
        report.append(
            f"| {name} | {dev['compoundedReturnPct']}% | {dev['profitFactor']} | {dev['maxDrawdownPct']}% | "
            f"{val['compoundedReturnPct']}% | {val['profitFactor']} | {hold['trades']} | {hold['compoundedReturnPct']}% | "
            f"{hold['profitFactor']} | {hold['severeReturnPct']}% | {hold['maxDrawdownPct']}% |"
        )
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-reversal-ensemble-v38.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "pengu-reversal-ensemble-v38.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
