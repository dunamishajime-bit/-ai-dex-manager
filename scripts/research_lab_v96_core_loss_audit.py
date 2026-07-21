from __future__ import annotations

import datetime as dt
import json
import os
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Dict, List

import research_lab_v35_weight_band_strong_v95 as v95

core = v95.core
SYMBOLS = ("BTC", "ETH", "BNB", "SOL")
NORMAL_COST_BPS = 10.0
SEVERE_COST_BPS = 50.0
LIVE_WINDOW_BARS = 400


def product_return(values: List[float]) -> float:
    equity = 1.0
    for value in values:
        equity *= max(0.001, 1.0 + float(value))
    return (equity - 1.0) * 100.0


def metrics(values: List[float]) -> dict:
    equity = peak = 1.0
    max_dd = 0.0
    wins = losses = 0.0
    positive = 0
    for value in values:
        value = float(value)
        if value > 0:
            wins += value
            positive += 1
        elif value < 0:
            losses += abs(value)
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1.0)
    return {
        "compoundedReturnPct": (equity - 1.0) * 100.0,
        "maxDrawdownPct": max_dd * 100.0,
        "profitFactor": wins / losses if losses > 0 else 999.0 if wins > 0 else None,
        "positiveBarsPct": positive / len(values) * 100.0 if values else 0.0,
        "bars": len(values),
    }


def signature(target: Dict[str, float]):
    return tuple(sorted((symbol, 1 if float(weight) > 0 else -1)
                        for symbol, weight in target.items() if abs(float(weight)) > 1e-12))


def v35_scale(item: dict, feature: dict) -> float:
    config = core.CoreConfig()
    multiplier = 1.0
    if int(item.get("regime", 0)) > 0:
        strong = (bool(feature.get("closeAboveSma20", False))
                  and float(feature.get("mom20", 0.0)) >= 10.0
                  and float(feature.get("mom3", 0.0)) > 0.0)
        brake = (float(feature.get("shock", 0.0)) <= -4.0
                 or float(feature.get("skew", 1.0)) > 1.35
                 or not bool(feature.get("closeAboveSma20", False)))
        multiplier = config.brake_mult if brake else config.strong_mult if strong else config.normal_mult
    raw_gross = float(item.get("exposure", 0.0)) * multiplier
    cap = min(1.0, config.gross_cap / raw_gross) if raw_gross > 0 else 1.0
    return multiplier * cap


def build_audit(raw: dict) -> dict:
    times = list(raw["times"])
    targets, target_diag = v95.v90.stabilize(raw["targets"], times, v95.TARGET_CONFIG)
    base_core = core.v32.core_series(targets, times, raw["bars"], raw["indexes"], raw["funding"], 10, 0, 0)
    severe_core = core.v32.core_series(targets, times, raw["bars"], raw["indexes"], raw["funding"], 50, 1, 3)
    features = core.v34.features_with_vol(times, targets, raw["bars"], raw["indexes"], raw["funding"])
    config = core.CoreConfig()
    base_rows = core.core_rows(config, times, base_core, features)
    severe_rows = core.core_rows(config, times, severe_core, features)
    context = v95.v89.context_for(targets, raw, base_core, features)
    normal, normal_diag = v95.v86.controlled_core(base_rows, context, v95.STRONG_CONFIG)
    severe, severe_diag = v95.v86.controlled_core(severe_rows, context, v95.STRONG_CONFIG)
    normal_map = {int(row["ts"]): row for row in normal}
    severe_map = {int(row["ts"]): row for row in severe}

    bars = []
    previous_target: Dict[str, float] = {}
    for position, ts in enumerate(times):
        source = position - 1
        target = dict(targets.get(times[source], {})) if source >= 0 else {}
        item = base_core.get(ts, {"return": 0.0, "exposure": 0.0, "regime": 0})
        feature = features.get(ts, {})
        controller = normal_map.get(ts, {"return": 0.0, "scale": 0.0, "boost": 0.0, "whipsawActive": False, "ddStage": 0})
        base_scale = v35_scale(item, feature)
        controller_scale = float(controller.get("scale", 0.0))
        final_scale = base_scale * controller_scale
        symbol_rows = {}
        for symbol in SYMBOLS:
            weight = float(target.get(symbol, 0.0)) * final_scale
            index = raw["indexes"][symbol].get(ts)
            price_return = 0.0
            if index is not None:
                candle = raw["bars"][symbol][index]
                price_return = float(candle["close"]) / float(candle["open"]) - 1.0
            funding_pct = float(raw["funding"].get(symbol, {}).get(ts, 0.0))
            raw_turnover = abs(float(target.get(symbol, 0.0)) - float(previous_target.get(symbol, 0.0)))
            contribution = weight * price_return - weight * funding_pct / 100.0 - raw_turnover * NORMAL_COST_BPS / 10_000.0 * final_scale
            symbol_rows[symbol] = {
                "weight": weight,
                "priceReturn": price_return,
                "fundingPct": funding_pct,
                "turnover": raw_turnover * final_scale,
                "contribution": contribution,
            }
        exact_return = float(controller.get("return", 0.0))
        attributed = sum(float(row["contribution"]) for row in symbol_rows.values())
        date = dt.datetime.fromtimestamp(ts / 1000, tz=dt.timezone.utc)
        bars.append({
            "ts": ts,
            "iso": date.isoformat(),
            "year": str(date.year),
            "half": f"{date.year}H{1 if date.month <= 6 else 2}",
            "target": target,
            "signature": signature(target),
            "normalReturn": exact_return,
            "severeReturn": float(severe_map.get(ts, {}).get("return", 0.0)),
            "attributionResidual": exact_return - attributed,
            "boost": float(controller.get("boost", 0.0)) > 0,
            "whipsaw": bool(controller.get("whipsawActive", False)),
            "ddStage": int(controller.get("ddStage", 0)),
            "portfolioDrawdown": float(context.get(ts, {}).get("portfolioDrawdown", 0.0)),
            "symbol": symbol_rows,
        })
        previous_target = target

    episodes = []
    active = {}
    sequence = 0
    for bar_index, bar in enumerate(bars):
        for symbol in SYMBOLS:
            row = bar["symbol"][symbol]
            weight = float(row["weight"])
            side = 1 if weight > 1e-12 else -1 if weight < -1e-12 else 0
            current = active.get(symbol)
            if current and side != current["side"]:
                current["exitTs"] = int(bar["ts"])
                active.pop(symbol, None)
                current = None
            if side and current is None:
                sequence += 1
                current = {
                    "id": f"{symbol}-{sequence}", "symbol": symbol, "side": side,
                    "entryTs": int(bar["ts"]), "exitTs": int(bar["ts"]), "entryYear": bar["year"],
                    "bars": 0, "netContribution": 0.0, "maxAdverse": 0.0, "maxFavorable": 0.0,
                    "entryBoost": bool(bar["boost"]), "entryWhipsaw": bool(bar["whipsaw"]),
                    "entryDdStage": int(bar["ddStage"]), "anyBoost": bool(bar["boost"]),
                    "anyWhipsaw": bool(bar["whipsaw"]), "maxDdStage": int(bar["ddStage"]),
                    "running": 0.0, "byBar": {},
                }
                episodes.append(current)
                active[symbol] = current
            if current and side:
                value = float(row["contribution"])
                current["bars"] += 1
                current["exitTs"] = int(bar["ts"]) + 12 * 60 * 60 * 1000
                current["netContribution"] += value
                current["running"] += value
                current["maxAdverse"] = min(current["maxAdverse"], current["running"])
                current["maxFavorable"] = max(current["maxFavorable"], current["running"])
                current["anyBoost"] = bool(current["anyBoost"] or bar["boost"])
                current["anyWhipsaw"] = bool(current["anyWhipsaw"] or bar["whipsaw"])
                current["maxDdStage"] = max(int(current["maxDdStage"]), int(bar["ddStage"]))
                current["byBar"][bar_index] = value

    def group(key_fn):
        grouped = defaultdict(list)
        for episode in episodes:
            grouped[key_fn(episode)].append(episode)
        result = []
        for name, rows in grouped.items():
            values = [float(row["netContribution"]) for row in rows]
            result.append({
                "group": name, "episodes": len(rows),
                "years": sorted(set(str(row["entryYear"]) for row in rows)),
                "winRatePct": sum(value > 0 for value in values) / len(values) * 100.0,
                "totalNetContributionPct": sum(values) * 100.0,
                "averageNetContributionPct": statistics.fmean(values) * 100.0,
            })
        return sorted(result, key=lambda item: item["totalNetContributionPct"])

    def duration(row):
        bars_count = int(row["bars"])
        return "1-2" if bars_count <= 2 else "3-6" if bars_count <= 6 else "7-14" if bars_count <= 14 else "15+"

    groups = {
        "symbol": group(lambda row: row["symbol"]),
        "symbolYear": group(lambda row: f"{row['symbol']}:{row['entryYear']}"),
        "boost": group(lambda row: f"{row['symbol']}:{'BOOST' if row['anyBoost'] else 'NO_BOOST'}"),
        "entryState": group(lambda row: f"{row['symbol']}:DD{row['entryDdStage']}:{'WHIP' if row['entryWhipsaw'] else 'CALM'}"),
        "experiencedState": group(lambda row: f"{row['symbol']}:MAXDD{row['maxDdStage']}:{'WHIP' if row['anyWhipsaw'] else 'CALM'}"),
        "duration": group(lambda row: f"{row['symbol']}:{duration(row)}"),
    }
    structural = [item for section in (groups["boost"], groups["entryState"], groups["experiencedState"], groups["duration"])
                  for item in section if item["episodes"] >= 5 and len(item["years"]) >= 2
                  and item["totalNetContributionPct"] < 0 and item["winRatePct"] < 45]

    worst = sorted(episodes, key=lambda row: float(row["netContribution"]))[:20]
    best = sorted(episodes, key=lambda row: float(row["netContribution"]), reverse=True)
    concentration = {}
    for count in (1, 3, 5):
        removed = {row["id"] for row in best[:count]}
        returns = []
        for index, bar in enumerate(bars):
            value = float(bar["normalReturn"])
            for episode in episodes:
                if episode["id"] in removed:
                    value -= float(episode["byBar"].get(index, 0.0))
            returns.append(value)
        concentration[f"removeTop{count}Episodes"] = metrics(returns)

    symbol_summary = {}
    for symbol in SYMBOLS:
        values = [float(bar["symbol"][symbol]["contribution"]) for bar in bars]
        symbol_episodes = [row for row in episodes if row["symbol"] == symbol]
        symbol_summary[symbol] = {
            "totalContributionPct": sum(values) * 100.0,
            "episodeCount": len(symbol_episodes),
            "winningEpisodesPct": sum(float(row["netContribution"]) > 0 for row in symbol_episodes) / len(symbol_episodes) * 100.0 if symbol_episodes else 0.0,
            "worstEpisodePct": min((float(row["netContribution"]) for row in symbol_episodes), default=0.0) * 100.0,
            "attributionRemovalMetrics": metrics([float(bar["normalReturn"]) - float(bar["symbol"][symbol]["contribution"]) for bar in bars]),
        }

    annual = {}
    half = {}
    for key, target in (("year", annual), ("half", half)):
        for period in sorted(set(str(bar[key]) for bar in bars)):
            rows = [bar for bar in bars if str(bar[key]) == period]
            target[period] = {
                "normal": metrics([float(row["normalReturn"]) for row in rows]),
                "severe": metrics([float(row["severeReturn"]) for row in rows]),
            }

    window_times = times[-LIVE_WINDOW_BARS:]
    window_raw_targets = {ts: raw["targets"].get(ts, {}) for ts in window_times}
    window_targets, _ = v95.v90.stabilize(window_raw_targets, window_times, v95.TARGET_CONFIG)
    window_base_core = core.v32.core_series(window_targets, window_times, raw["bars"], raw["indexes"], raw["funding"], 10, 0, 0)
    window_features = core.v34.features_with_vol(window_times, window_targets, raw["bars"], raw["indexes"], raw["funding"])
    window_base_rows = core.core_rows(config, window_times, window_base_core, window_features)
    window_context = v95.v89.context_for(window_targets, {**raw, "times": window_times}, window_base_core, window_features)
    window_controlled, _ = v95.v86.controlled_core(window_base_rows, window_context, v95.STRONG_CONFIG)
    latest_ts = times[-1]
    latest_full = normal_map[latest_ts]
    latest_window = window_controlled[-1]
    full_target = targets.get(latest_ts, {})
    window_target = window_targets.get(latest_ts, {})
    target_difference = core.v4.turnover(full_target, window_target)

    return {
        "strategyId": "V96_NON_PENGU_CORE_LOSS_AUDIT",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "auditPolicy": {
            "productionChanged": False, "parameterSearchPerformed": False,
            "structuralLossRule": "At least 5 episodes, at least 2 entry years, negative total contribution, win rate below 45%.",
            "normalCostBps": NORMAL_COST_BPS, "severeCostBps": SEVERE_COST_BPS,
        },
        "coverage": {"start": dt.datetime.fromtimestamp(times[0] / 1000, tz=dt.timezone.utc).isoformat(),
                     "end": dt.datetime.fromtimestamp(times[-1] / 1000, tz=dt.timezone.utc).isoformat(),
                     "bars": len(times)},
        "full": {"normal": metrics([float(row["normalReturn"]) for row in bars]),
                 "severe": metrics([float(row["severeReturn"]) for row in bars])},
        "annual": annual, "halfYear": half,
        "symbolSummary": symbol_summary,
        "episodeCount": len(episodes),
        "attribution": {
            "totalResidualPct": sum(float(bar["attributionResidual"]) for bar in bars) * 100.0,
            "maxAbsResidualPerBarPct": max((abs(float(bar["attributionResidual"])) for bar in bars), default=0.0) * 100.0,
        },
        "bestEpisodes": [{**{key: value for key, value in row.items() if key not in ("running", "byBar")},
                          "entryIso": dt.datetime.fromtimestamp(row["entryTs"] / 1000, tz=dt.timezone.utc).isoformat(),
                          "exitIso": dt.datetime.fromtimestamp(row["exitTs"] / 1000, tz=dt.timezone.utc).isoformat(),
                          "netContributionPct": float(row["netContribution"]) * 100.0}
                         for row in best[:10]],
        "worstEpisodes": [{**{key: value for key, value in row.items() if key not in ("running", "byBar")},
                           "entryIso": dt.datetime.fromtimestamp(row["entryTs"] / 1000, tz=dt.timezone.utc).isoformat(),
                           "exitIso": dt.datetime.fromtimestamp(row["exitTs"] / 1000, tz=dt.timezone.utc).isoformat(),
                           "netContributionPct": float(row["netContribution"]) * 100.0,
                           "maxAdversePct": float(row["maxAdverse"]) * 100.0}
                          for row in worst],
        "lossGroups": groups,
        "structuralLossCandidates": structural,
        "concentration": concentration,
        "rolling400StateCheck": {
            "bars": LIVE_WINDOW_BARS,
            "latestTs": latest_ts,
            "targetDifference": target_difference,
            "fullTarget": full_target, "windowTarget": window_target,
            "fullScale": latest_full.get("scale"), "windowScale": latest_window.get("scale"),
            "fullBoost": latest_full.get("boost"), "windowBoost": latest_window.get("boost"),
            "fullDdStage": latest_full.get("ddStage"), "windowDdStage": latest_window.get("ddStage"),
            "fullWhipsaw": latest_full.get("whipsawActive"), "windowWhipsaw": latest_window.get("whipsawActive"),
        },
        "targetDiagnostics": target_diag,
        "controlDiagnostics": {"normal": normal_diag, "severe": severe_diag},
        "limitations": [
            "Uses frozen historical Aster data through 2026-07-01, not actual VPS fills after deployment.",
            "Symbol attribution reconstructs the fixed research return path and should not be read as an independently re-optimized portfolio.",
            "The 400-bar check isolates state truncation; it does not reproduce every production market-data bootstrap detail.",
            "No losing episode is deleted and no threshold is selected from these results.",
        ],
    }


def main() -> None:
    raw = v95.v89.build_raw()
    result = core.rounded(build_audit(raw))
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    state_dir.mkdir(parents=True, exist_ok=True)
    json_path = state_dir / "v96-core-loss-audit.json"
    md_path = state_dir / "v96-core-loss-audit.md"
    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    normal = result["full"]["normal"]
    severe = result["full"]["severe"]
    rolling = result["rolling400StateCheck"]
    lines = [
        "# V96 Non-PENGU Core Loss Audit", "",
        f"- Period: {result['coverage']['start']} to {result['coverage']['end']}",
        f"- Normal: {normal['compoundedReturnPct']}% / DD {normal['maxDrawdownPct']}% / PF {normal['profitFactor']}",
        f"- Severe: {severe['compoundedReturnPct']}% / DD {severe['maxDrawdownPct']}% / PF {severe['profitFactor']}",
        f"- Episodes: {result['episodeCount']}",
        f"- Structural loss candidates: {len(result['structuralLossCandidates'])}",
        f"- 400-bar target difference: {rolling['targetDifference']}",
        f"- Full/window DD stage: {rolling['fullDdStage']} / {rolling['windowDdStage']}",
        f"- Full/window boost: {rolling['fullBoost']} / {rolling['windowBoost']}",
        "- Production changed: **NO**", "", "## Symbol summary", "",
        "| Symbol | Total contribution % | Episodes | Win % | Worst % |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for symbol, item in result["symbolSummary"].items():
        lines.append(f"| {symbol} | {item['totalContributionPct']} | {item['episodeCount']} | {item['winningEpisodesPct']} | {item['worstEpisodePct']} |")
    lines.extend(["", "## Worst episodes", "", "| Symbol | Entry | Exit | Bars | Net % | MAE % | Boost | DD | Whipsaw |",
                  "| --- | --- | --- | ---: | ---: | ---: | --- | ---: | --- |"])
    for row in result["worstEpisodes"][:15]:
        lines.append(f"| {row['symbol']} | {row['entryIso'][:10]} | {row['exitIso'][:10]} | {row['bars']} | {row['netContributionPct']} | {row['maxAdversePct']} | {row['anyBoost']} | {row['entryDdStage']} | {row['entryWhipsaw']} |")
    lines.extend(["", "## Structural loss candidates", ""])
    if result["structuralLossCandidates"]:
        lines.extend(["| Group | Episodes | Years | Win % | Total net % |", "| --- | ---: | --- | ---: | ---: |"])
        for row in result["structuralLossCandidates"]:
            lines.append(f"| {row['group']} | {row['episodes']} | {','.join(row['years'])} | {row['winRatePct']} | {row['totalNetContributionPct']} |")
    else:
        lines.append("No cluster met the predeclared structural-loss rule.")
    lines.extend(["", "Historical/reused evidence only. No production parameter was tuned."])
    markdown = "\n".join(lines) + "\n"
    md_path.write_text(markdown, encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n" + markdown)
    print(markdown)


if __name__ == "__main__":
    main()
