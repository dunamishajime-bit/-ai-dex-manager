from __future__ import annotations

import datetime as dt
import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional

import research_lab_v96_flat_fallback_entry_bt as flat

pc = flat.pc
core = flat.core
v69 = flat.v69
HOUR = flat.HOUR
BUCKET = 12 * HOUR
START_2025 = flat.START_2025
START_2026 = flat.START_2026
MONTHS = flat.MONTHS
ENTRY_CONFIG = next(config for config in flat.BEAR_CONFIGS if config.config_id == "BS25_H4_L20_M3_V090")


@dataclass(frozen=True)
class ExitConfig:
    config_id: str
    mode: str
    max_hold_bars: int = 4
    checkpoint_bars: int = 2
    continue_min_profit_pct: float = 0.0
    reversal_bar_pct: float = 0.0
    momentum_reversal_pct: float = 0.0
    partial_scale: float = 1.0
    trail_activation_pct: float = 0.0
    trail_retention: float = 0.0


EXIT_CONFIGS = (
    ExitConfig("BASE_H4", "FIXED", max_hold_bars=4),
    ExitConfig("FIXED_H2", "FIXED", max_hold_bars=2),
    ExitConfig("FIXED_H3", "FIXED", max_hold_bars=3),
    ExitConfig("KEEP_H4_IF_PNL_GE_0_AT2", "CHECKPOINT", continue_min_profit_pct=0.0),
    ExitConfig("KEEP_H4_IF_PNL_GE_1_AT2", "CHECKPOINT", continue_min_profit_pct=1.0),
    ExitConfig("KEEP_H4_IF_PNL_GE_2_AT2", "CHECKPOINT", continue_min_profit_pct=2.0),
    ExitConfig("JOINT_REVERSAL_AFTER1", "JOINT_REVERSAL", checkpoint_bars=1, reversal_bar_pct=0.0),
    ExitConfig("MOM3_REVERSAL_AFTER2", "MOMENTUM_REVERSAL", checkpoint_bars=2, momentum_reversal_pct=0.0),
    ExitConfig("HALF_AFTER2_H4", "PARTIAL", checkpoint_bars=2, partial_scale=0.50),
    ExitConfig("TRAIL2_GIVEBACK50_H4", "TRAIL", checkpoint_bars=1, trail_activation_pct=2.0, trail_retention=0.50),
    ExitConfig("TRAIL3_GIVEBACK50_H4", "TRAIL", checkpoint_bars=1, trail_activation_pct=3.0, trail_retention=0.50),
)


def rounded(value):
    return flat.rounded(value)


def iso_ms(value: int) -> str:
    return flat.iso_ms(value)


def row_at(raw: dict, symbol: str, ts: int) -> Optional[dict]:
    index = raw["indexes"].get(symbol, {}).get(ts)
    if index is None:
        return None
    return raw["bars"][symbol][index]


def close_return_pct(entry_price: float, current_price: float, side: int = -1) -> float:
    if entry_price <= 0:
        return 0.0
    return side * (current_price / entry_price - 1.0) * 100.0


def build_exit_targets(exit_config: ExitConfig, raw: dict, base_targets: Dict[int, Dict[str, float]]) -> tuple[Dict[int, Dict[str, float]], dict]:
    targets: Dict[int, Dict[str, float]] = {}
    pending: Optional[dict] = None
    active: Optional[dict] = None
    generated_signals = entries = suppressed_by_primary = exits = partial_rebalances = 0
    exit_reasons: Dict[str, int] = {}
    entries_by_symbol = {symbol: 0 for symbol in flat.ALT_SYMBOLS}
    entries_by_year: Dict[str, int] = {}
    episodes: List[dict] = []

    def close_active(reason: str, decision_ts: int) -> None:
        nonlocal active, exits
        if active is None:
            return
        next_row = row_at(raw, active["symbol"], decision_ts + BUCKET)
        exit_price = float(next_row["open"]) if next_row is not None else float(active["lastClose"])
        raw_return = close_return_pct(float(active["entryPrice"]), exit_price, -1)
        episodes.append({
            "symbol": active["symbol"],
            "entryTs": active["entryTs"],
            "exitDecisionTs": decision_ts,
            "exitTs": decision_ts + BUCKET,
            "barsHeld": active["age"],
            "rawPriceReturnPct": raw_return,
            "maxFavorablePct": active["mfePct"],
            "reason": reason,
        })
        exit_reasons[reason] = exit_reasons.get(reason, 0) + 1
        exits += 1
        active = None

    for ts in raw["times"]:
        primary_active = bool(base_targets.get(ts, {}))
        if primary_active:
            if active is not None:
                close_active("PRIMARY_REACTIVATION", ts - BUCKET)
                suppressed_by_primary += 1
            elif pending is not None:
                suppressed_by_primary += 1
            targets[ts] = {}
        else:
            if active is None and pending is not None:
                entry_row = row_at(raw, pending["symbol"], ts)
                if entry_row is not None and float(entry_row["open"]) > 0:
                    active = {
                        **pending,
                        "entryTs": ts,
                        "entryPrice": float(entry_row["open"]),
                        "age": 0,
                        "scale": 1.0,
                        "mfePct": 0.0,
                        "lastClose": float(entry_row["open"]),
                    }
                    entries += 1
                    entries_by_symbol[active["symbol"]] += 1
                    year = str(dt.datetime.fromtimestamp(ts / 1000, tz=dt.timezone.utc).year)
                    entries_by_year[year] = entries_by_year.get(year, 0) + 1
            if active is not None:
                symbol = active["symbol"]
                weight = -ENTRY_CONFIG.gross * float(active["scale"])
                targets[ts] = {symbol: weight}
                current = row_at(raw, symbol, ts)
                btc = row_at(raw, "BTC", ts)
                if current is None:
                    close_active("MISSING_BAR", ts)
                else:
                    active["age"] += 1
                    active["lastClose"] = float(current["close"])
                    favorable = close_return_pct(float(active["entryPrice"]), float(current["low"]), -1)
                    active["mfePct"] = max(float(active["mfePct"]), favorable)
                    pnl_pct = close_return_pct(float(active["entryPrice"]), float(current["close"]), -1)
                    symbol_bar_pct = flat.bar_return_pct(current)
                    btc_bar_pct = flat.bar_return_pct(btc) if btc is not None else 0.0
                    exit_reason = None

                    if exit_config.mode == "CHECKPOINT" and active["age"] == exit_config.checkpoint_bars:
                        if pnl_pct < exit_config.continue_min_profit_pct:
                            exit_reason = f"CHECKPOINT_PNL_LT_{exit_config.continue_min_profit_pct:g}"
                    elif exit_config.mode == "JOINT_REVERSAL" and active["age"] >= exit_config.checkpoint_bars:
                        if symbol_bar_pct > exit_config.reversal_bar_pct and btc_bar_pct > 0.0:
                            exit_reason = "JOINT_POSITIVE_BAR_REVERSAL"
                    elif exit_config.mode == "MOMENTUM_REVERSAL" and active["age"] >= exit_config.checkpoint_bars:
                        index = raw["indexes"].get(symbol, {}).get(ts)
                        mom3 = flat.momentum_pct(raw["bars"][symbol], index, 3) if index is not None else None
                        if mom3 is not None and mom3 > exit_config.momentum_reversal_pct:
                            exit_reason = "ALT_MOM3_POSITIVE"
                    elif exit_config.mode == "PARTIAL" and active["age"] == exit_config.checkpoint_bars:
                        if float(active["scale"]) > exit_config.partial_scale + 1e-12:
                            active["scale"] = exit_config.partial_scale
                            partial_rebalances += 1
                    elif exit_config.mode == "TRAIL" and active["age"] >= exit_config.checkpoint_bars:
                        mfe = float(active["mfePct"])
                        if mfe >= exit_config.trail_activation_pct and pnl_pct <= mfe * exit_config.trail_retention:
                            exit_reason = "PROFIT_GIVEBACK_TRAIL"

                    if exit_reason is None and active is not None and active["age"] >= exit_config.max_hold_bars:
                        exit_reason = f"MAX_HOLD_{exit_config.max_hold_bars}"
                    if exit_reason is not None:
                        close_active(exit_reason, ts)
            else:
                targets[ts] = {}

        pending = flat.signal_at(ENTRY_CONFIG, raw, ts)
        if pending is not None:
            generated_signals += 1

    if active is not None:
        last_ts = raw["times"][-1]
        close_active("END_OF_SAMPLE", last_ts)

    reused_2026 = [item for item in episodes if int(item["entryTs"]) >= START_2026]
    validation_2025 = [item for item in episodes if START_2025 <= int(item["entryTs"]) < START_2026]

    def episode_summary(items: List[dict]) -> dict:
        returns = [float(item["rawPriceReturnPct"]) for item in items]
        return {
            "episodes": len(items),
            "wins": sum(value > 0 for value in returns),
            "winRatePct": sum(value > 0 for value in returns) / len(returns) * 100.0 if returns else None,
            "meanRawPriceReturnPct": sum(returns) / len(returns) if returns else None,
            "totalRawPriceReturnPct": sum(returns),
            "details": items,
        }

    return targets, {
        "generatedSignals": generated_signals,
        "entries": entries,
        "suppressedByPrimary": suppressed_by_primary,
        "entriesBySymbol": entries_by_symbol,
        "entriesByYear": entries_by_year,
        "activeBuckets": sum(bool(targets.get(ts, {})) for ts in raw["times"]),
        "exits": exits,
        "partialRebalances": partial_rebalances,
        "exitReasons": exit_reasons,
        "validation2025Episodes": episode_summary(validation_2025),
        "reused2026H1Episodes": episode_summary(reused_2026),
        "allEpisodes": episode_summary(episodes),
    }


def comparison(candidate: dict, reference: dict) -> dict:
    result = {}
    for window in ("discovery2023_2024", "validation2025", "reused2026H1", "full"):
        result[window] = {}
        for mode in ("normal", "severe"):
            current = candidate["windows"][window][mode]
            base = reference["windows"][window][mode]
            result[window][mode] = {
                "returnPctPoints": float(current["compoundedReturnPct"]) - float(base["compoundedReturnPct"]),
                "maxDrawdownPctPoints": float(current["maxDrawdownPct"]) - float(base["maxDrawdownPct"]),
                "monthlyProfitFactorDelta": float(current["monthlyProfitFactor"]) - float(base["monthlyProfitFactor"]),
            }
    return result


def discovery_pass(item: dict, original_h4: dict) -> bool:
    uplift = item["uplift"]["discovery2023_2024"]
    vs_h4 = item["vsOriginalH4"]["discovery2023_2024"]
    return bool(
        item["fallbackDiagnostics"]["entries"] >= 10
        and uplift["normal"]["returnPctPoints"] > 0.0
        and uplift["severe"]["returnPctPoints"] >= 0.0
        and uplift["normal"]["maxDrawdownPctPoints"] >= -2.0
        and uplift["severe"]["maxDrawdownPctPoints"] >= -2.0
        and vs_h4["normal"]["returnPctPoints"] >= -12.0
        and vs_h4["severe"]["returnPctPoints"] >= -5.0
    )


def validation_pass(item: dict) -> bool:
    value = item["uplift"]["validation2025"]
    return bool(
        item["discoveryPass"]
        and value["normal"]["returnPctPoints"] >= 0.0
        and value["severe"]["returnPctPoints"] >= 0.0
        and value["normal"]["maxDrawdownPctPoints"] >= -2.0
        and value["severe"]["maxDrawdownPctPoints"] >= -2.0
    )


def reused_2026_pass(item: dict) -> bool:
    value = item["uplift"]["reused2026H1"]
    return bool(
        item["validationPass"]
        and value["normal"]["returnPctPoints"] >= 0.0
        and value["severe"]["returnPctPoints"] >= 0.0
    )


def select_on_discovery(items: List[dict]) -> Optional[dict]:
    passed = [item for item in items if item["discoveryPass"]]
    if not passed:
        return None
    passed.sort(key=lambda item: (
        item["uplift"]["discovery2023_2024"]["severe"]["returnPctPoints"],
        item["uplift"]["discovery2023_2024"]["normal"]["returnPctPoints"],
        -item["orders"]["extraOrderEventsProxy"],
    ), reverse=True)
    return passed[0]


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    raw = pc.build_raw_with_hourly()
    base_targets = raw["targets"]
    base_profile = pc.build_profile(base_targets, raw)
    base_frequency = pc.freq.count_core_frequency(base_targets, raw["times"], raw["stabilization"])

    trades = v69.scale_trades(pc.v96.TARGET_V67_GROSS)
    trade_start = min(int(trade["entry_ts"]) for trade in trades)
    trade_end = max(int(trade["exit_ts"]) for trade in trades)
    pengu_rows = core.fetch_klines("PENGUUSDT", trade_start - 30 * v69.DAY, trade_end + HOUR)
    baseline_combined, baseline_windows = flat.combined_windows(base_profile, pengu_rows)
    baseline = {
        "config": {"config_id": "CURRENT_V96_VOLUME50_TURNOVER075"},
        "combined": baseline_combined,
        "windows": baseline_windows,
        "orders": {
            "officialOrderEvents": base_frequency["orderEvents"],
            "monthlyOrderEvents": base_frequency["orderEvents"] / MONTHS,
            "targetFrequency": flat.target_frequency(base_targets, raw["times"]),
        },
    }

    built: Dict[str, tuple] = {}
    for config in EXIT_CONFIGS:
        fallback_targets, diagnostics = build_exit_targets(config, raw, base_targets)
        item, _ = flat.evaluate_target_map(
            {
                "config_id": config.config_id,
                "entry": asdict(ENTRY_CONFIG),
                "exit": asdict(config),
            },
            fallback_targets,
            diagnostics,
            raw,
            base_targets,
            base_frequency,
            baseline_windows,
            pengu_rows,
        )
        built[config.config_id] = (item, fallback_targets)

    original_h4 = built["BASE_H4"][0]
    candidates: List[dict] = []
    for config in EXIT_CONFIGS:
        item, _mapping = built[config.config_id]
        item["vsOriginalH4"] = comparison(item, original_h4)
        item["discoveryPass"] = discovery_pass(item, original_h4)
        item["validationPass"] = validation_pass(item)
        item["reused2026Pass"] = reused_2026_pass(item)
        candidates.append(item)

    selected = select_on_discovery(candidates)
    selected_map = built[selected["config"]["config_id"]][1] if selected is not None else None
    triple_pass = [item for item in candidates if item["reused2026Pass"]]
    triple_pass.sort(key=lambda item: (
        item["uplift"]["validation2025"]["severe"]["returnPctPoints"],
        item["uplift"]["reused2026H1"]["severe"]["returnPctPoints"],
        item["uplift"]["full"]["normal"]["returnPctPoints"],
    ), reverse=True)
    observed_all_window_leader = triple_pass[0] if triple_pass else None

    stress = None
    if selected_map is not None:
        stress = flat.removal_stress(
            selected_map, raw, base_targets, base_frequency, baseline_windows, pengu_rows
        )

    if selected is None:
        status = "NO_BEAR_SHORT_EXIT_DISCOVERY_PASS"
    elif selected["reused2026Pass"]:
        status = "BEAR_SHORT_EXIT_HISTORICAL_LEAD_FORWARD_REQUIRED"
    elif selected["validationPass"]:
        status = "BEAR_SHORT_EXIT_2025_PASS_REUSED_2026_FAIL"
    else:
        status = "NO_BEAR_SHORT_EXIT_VALIDATION_PASS"

    payload = rounded({
        "version": 1,
        "strategyId": "DISDEX_V96_BEAR_SHORT_FIXED_ENTRY_EXIT_OPTIMIZATION_BT",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "period": {
            "startInclusive": iso_ms(core.CORE_START),
            "discoveryEndExclusive": iso_ms(START_2025),
            "validationEndExclusive": iso_ms(START_2026),
            "endExclusive": iso_ms(core.CORE_END),
        },
        "method": {
            "fixedEntry": asdict(ENTRY_CONFIG),
            "entrySelection": "Frozen from the prior flat-only fallback study; no Bear Short entry parameter was changed",
            "exitSelection": "Exit family selected only on 2023-2024 Discovery, ranked by Severe uplift then Normal uplift",
            "validation": "2025 is independent chronological Validation",
            "reusedEvidence": "2026H1 is inspected only after selection and is not a pristine Holdout",
            "causality": "Every exit decision uses a completed 12h bar and executes through the next target bucket; no same-bar close execution",
            "costs": "Normal 10 bps; Severe 50 bps plus existing one-bucket delay, funding and slippage stress",
        },
        "baseline": baseline,
        "originalBearH4": original_h4,
        "selectedOnDiscovery": selected,
        "observedAllWindowLeader": observed_all_window_leader,
        "candidates": candidates,
        "stressForSelected": stress,
        "resultGate": {
            "discovery": "At least 10 entries; positive Normal and Severe uplift vs current V96; DD within 2 points; retain original H4 Discovery within 12 Normal / 5 Severe points",
            "validation2025": "Non-negative Normal and Severe uplift with DD within 2 points",
            "reused2026H1": "Non-negative Normal and Severe uplift, evaluated only after Discovery selection and 2025 validation",
            "productionAuthorization": False,
        },
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
            "merged": False,
        },
        "limitations": [
            "2026H1 has already been observed in prior V96 research and cannot be treated as an untouched Holdout.",
            "The observedAllWindowLeader is descriptive only if it differs from the Discovery-selected candidate.",
            "Exit candidates operate on completed 12h bars; intrabucket stop execution was not assumed.",
            "Historical improvement cannot authorize Production without an exact frozen Forward/Shadow test.",
        ],
    })

    state_dir.mkdir(parents=True, exist_ok=True)
    json_path = state_dir / "v96-bear-short-exit-bt.json"
    md_path = state_dir / "v96-bear-short-exit-bt.md"
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# V96 Bear Short Fixed-Entry Exit Backtest",
        "",
        f"Status: `{payload['status']}`",
        "",
        "| Exit | Entries | Discovery N/S uplift | 2025 N/S uplift | 2026H1 N/S uplift | Full N/S return | Est. orders |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for item in candidates:
        u = item["uplift"]
        w = item["windows"]["full"]
        lines.append(
            f"| {item['config']['config_id']} | {item['fallbackDiagnostics']['entries']} | "
            f"{u['discovery2023_2024']['normal']['returnPctPoints']:.4f}/{u['discovery2023_2024']['severe']['returnPctPoints']:.4f} | "
            f"{u['validation2025']['normal']['returnPctPoints']:.4f}/{u['validation2025']['severe']['returnPctPoints']:.4f} | "
            f"{u['reused2026H1']['normal']['returnPctPoints']:.4f}/{u['reused2026H1']['severe']['returnPctPoints']:.4f} | "
            f"{w['normal']['compoundedReturnPct']:.4f}%/{w['severe']['compoundedReturnPct']:.4f}% | "
            f"{item['orders']['combinedOrderEventsEstimate']} |"
        )
    if selected is not None:
        lines.extend([
            "",
            "## Discovery-selected exit",
            "",
            f"- Config: `{selected['config']['config_id']}`",
            f"- 2025 pass: `{selected['validationPass']}`",
            f"- Reused 2026H1 pass: `{selected['reused2026Pass']}`",
        ])
    if observed_all_window_leader is not None:
        lines.extend([
            "",
            "## Descriptive all-window leader",
            "",
            f"- Config: `{observed_all_window_leader['config']['config_id']}`",
            "- This is not selection-clean if it differs from the Discovery-selected exit.",
        ])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": payload["status"],
        "selectedOnDiscovery": selected["config"]["config_id"] if selected else None,
        "selected2025Pass": selected["validationPass"] if selected else None,
        "selected2026Pass": selected["reused2026Pass"] if selected else None,
        "observedAllWindowLeader": observed_all_window_leader["config"]["config_id"] if observed_all_window_leader else None,
        "json": str(json_path),
        "markdown": str(md_path),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
