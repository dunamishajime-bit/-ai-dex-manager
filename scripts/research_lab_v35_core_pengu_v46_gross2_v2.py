from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Dict, List, Optional

import research_lab_v35_core_pengu_v46_gross2 as base

_CAPTURE: dict = {}
_ORIGINAL_COMBINE = base.combine_rows


def corrected_build_pengu_trades(pengu: List[dict], btc: List[dict], funding: List[dict]) -> List[base.Trade]:
    _CAPTURE["pengu_rows"] = pengu
    p_map = {int(row["ts"]): index for index, row in enumerate(pengu)}
    b_map = {int(row["ts"]): index for index, row in enumerate(btc)}
    common = sorted(set(p_map) & set(b_map))

    p_close = [float(row["close"]) for row in pengu]
    p_volume = [float(row["volume"]) for row in pengu]
    b_close = [float(row["close"]) for row in btc]
    p_sma72 = base.rolling_mean(p_close, 72)
    p_sma168 = base.rolling_mean(p_close, 168)
    b_sma168 = base.rolling_mean(b_close, 168)
    p_mom6 = base.momentum(p_close, 6)
    p_mom24 = base.momentum(p_close, 24)
    p_mom48 = base.momentum(p_close, 48)
    p_mom120 = base.momentum(p_close, 120)
    b_mom48 = base.momentum(b_close, 48)
    b_mom72 = base.momentum(b_close, 72)
    b_mom120 = base.momentum(b_close, 120)
    p_rsi14 = base.rsi(p_close, 14)
    p_vol_ratio = base.volume_ratio(p_volume, 12, 72)

    long_signals: List[tuple[int, int]] = []
    short_signals: List[tuple[int, int]] = []
    for ts in common:
        if (ts // base.HOUR) % base.DECISION_HOURS != 0:
            continue
        pi = p_map[ts]
        bi = b_map[ts]
        if pi < 220 or bi < 220 or pi + 25 >= len(pengu):
            continue
        p_now = p_close[pi]
        b_now = b_close[bi]
        vol = p_vol_ratio[pi]
        if vol is None or vol < 0.8:
            continue

        prior_lows = [float(row["low"]) for row in pengu[pi - 24:pi]]
        if (
            prior_lows
            and p_mom6[pi] is not None
            and p_now < min(prior_lows)
            and p_mom6[pi] < 0.0
            and base.btc_risk(-1, b_now, b_sma168[bi], b_mom72[bi])
        ):
            short_signals.append((ts, pi))

        funding_now = base.latest_funding(funding, ts + base.HOUR - 1)
        slope_index = pi - 48
        prior_mom_index = pi - 12
        long_signal = bool(
            funding_now is not None
            and funding_now <= 0.0003
            and p_sma72[pi] is not None
            and p_sma168[pi] is not None
            and slope_index >= 0
            and p_sma168[slope_index] is not None
            and p_mom6[pi] is not None
            and prior_mom_index >= 0
            and p_mom6[prior_mom_index] is not None
            and p_mom24[pi] is not None
            and p_mom48[pi] is not None
            and p_mom120[pi] is not None
            and b_mom48[bi] is not None
            and b_mom120[bi] is not None
            and p_rsi14[pi] is not None
            and p_now > p_sma72[pi]
            and p_now > p_sma168[pi]
            and p_sma168[pi] > p_sma168[slope_index]
            and p_mom6[pi] > 1.0
            and p_mom6[prior_mom_index] <= 0.0
            and p_mom24[pi] > 0.0
            and p_mom120[pi] > 2.0
            and p_mom48[pi] - b_mom48[bi] > 1.0
            and p_mom120[pi] - b_mom120[bi] > 0.0
            and 45.0 <= p_rsi14[pi] <= 72.0
            and base.btc_risk(1, b_now, b_sma168[bi], b_mom72[bi])
        )
        if long_signal:
            long_signals.append((ts, pi))

    def materialize(signals: List[tuple[int, int]], side: int) -> List[base.Trade]:
        result: List[base.Trade] = []
        next_free = 0
        for signal_ts, pi in signals:
            entry_index = pi + 1
            exit_index = entry_index + 24
            entry_ts = int(pengu[entry_index]["ts"])
            if entry_ts < next_free:
                continue
            exit_ts = int(pengu[exit_index]["ts"])
            entry_price = float(pengu[entry_index]["open"])
            exit_price = float(pengu[exit_index]["open"])
            gross_pct = side * (exit_price / entry_price - 1.0) * 100.0
            paid_funding = side * base.funding_between(funding, entry_ts, exit_ts)
            result.append(base.Trade(
                entry_ts=entry_ts,
                exit_ts=exit_ts,
                side=side,
                entry_price=entry_price,
                exit_price=exit_price,
                gross_pct=gross_pct,
                funding_pct=paid_funding,
                base_pct=gross_pct - paid_funding - 0.12 - 0.02,
                severe_pct=gross_pct - paid_funding - 0.20 - 0.05,
                signal_ts=signal_ts,
            ))
            next_free = exit_ts
        return result

    long_trades = materialize(long_signals, 1)
    short_trades = materialize(short_signals, -1)
    grouped: Dict[int, List[base.Trade]] = {}
    for trade in [*long_trades, *short_trades]:
        grouped.setdefault(trade.entry_ts, []).append(trade)

    combined: List[base.Trade] = []
    next_free = 0
    for entry_ts in sorted(grouped):
        if entry_ts < next_free:
            continue
        candidates = grouped[entry_ts]
        chosen = next((trade for trade in candidates if trade.side < 0), candidates[0])
        combined.append(chosen)
        next_free = chosen.exit_ts
    _CAPTURE["trades"] = combined
    _CAPTURE["long_raw"] = long_trades
    _CAPTURE["short_raw"] = short_trades
    return combined


def exact_exit_series(
    rows: List[dict],
    trades: List[base.Trade],
    gross: float,
    excluded_profit_keys: Optional[set[tuple[int, int]]] = None,
) -> Dict[int, dict]:
    excluded_profit_keys = excluded_profit_keys or set()
    row_times = [int(row["ts"]) for row in rows]
    if not row_times:
        return {}
    buckets: Dict[int, dict] = {}
    first_bucket = row_times[0] // (12 * base.HOUR) * (12 * base.HOUR)
    last_bucket = row_times[-1] // (12 * base.HOUR) * (12 * base.HOUR)
    bucket = first_bucket
    while bucket <= last_bucket:
        active_hours = sum(
            any(trade.entry_ts <= bucket + hour * base.HOUR < trade.exit_ts for trade in trades)
            for hour in range(12)
        )
        buckets[bucket] = {
            "base": 0.0,
            "severe": 0.0,
            "maxExposure": gross if active_hours else 0.0,
            "averageExposure": gross * active_hours / 12.0,
            "baseFactors": [],
            "severeFactors": [],
        }
        bucket += 12 * base.HOUR

    for trade in trades:
        bucket = trade.exit_ts // (12 * base.HOUR) * (12 * base.HOUR)
        item = buckets[bucket]
        excluded = (trade.entry_ts, trade.side) in excluded_profit_keys
        base_pct = 0.0 if excluded and trade.base_pct > 0 else trade.base_pct
        severe_pct = 0.0 if excluded and trade.severe_pct > 0 else trade.severe_pct
        item["baseFactors"].append(1.0 + base_pct / 100.0 * gross)
        item["severeFactors"].append(1.0 + severe_pct / 100.0 * gross)

    for item in buckets.values():
        base_equity = severe_equity = 1.0
        for factor in item.pop("baseFactors"):
            base_equity *= max(0.001, factor)
        for factor in item.pop("severeFactors"):
            severe_equity *= max(0.001, factor)
        item["base"] = base_equity - 1.0
        item["severe"] = severe_equity - 1.0
    return buckets


def corrected_pengu_series(rows: List[dict], funding: List[dict], trades: List[base.Trade], gross: float) -> Dict[int, dict]:
    del funding
    return exact_exit_series(rows, trades, gross)


def capture_combine(core: List[dict], pengu: Dict[int, dict], severe: bool = False) -> List[dict]:
    _CAPTURE["severe_core_rows" if severe else "base_core_rows"] = core
    return _ORIGINAL_COMBINE(core, pengu, severe)


def main() -> None:
    base.build_pengu_trades = corrected_build_pengu_trades
    base.pengu_12h_series = corrected_pengu_series
    base.combine_rows = capture_combine
    base.main()

    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    json_path = state_dir / "v35-core-pengu-v46-gross2-bt.json"
    payload = json.loads(json_path.read_text(encoding="utf-8"))
    trades: List[base.Trade] = _CAPTURE["trades"]
    rows: List[dict] = _CAPTURE["pengu_rows"]
    wave24 = base.audit_waves(rows, trades, 24, 20.0)
    wave72 = base.audit_waves(rows, trades, 72, 35.0)
    events = [*wave24["details"], *wave72["details"]]
    excluded: set[tuple[int, int]] = set()
    for trade in trades:
        if trade.base_pct <= 0:
            continue
        if any(
            event["side"] == trade.side
            and trade.entry_ts < event["endTs"]
            and trade.exit_ts > event["startTs"]
            for event in events
        ):
            excluded.add((trade.entry_ts, trade.side))

    no_wave_series = exact_exit_series(rows, trades, base.PENGU_GROSS, excluded)
    conservative = _ORIGINAL_COMBINE(_CAPTURE["base_core_rows"], no_wave_series, False)
    conservative_severe = _ORIGINAL_COMBINE(_CAPTURE["severe_core_rows"], no_wave_series, True)
    payload["combined"]["conservativeNoLargeWaveProfit"] = base.metrics_with_observed_gross(
        conservative, base.CORE_START, base.CORE_END
    )
    payload["combined"]["conservativeNoLargeWaveProfitSevere"] = base.metrics_with_observed_gross(
        conservative_severe, base.CORE_START, base.CORE_END
    )
    payload["combined"]["excludedLargeWaveProfitTrades"] = len(excluded)
    payload["pengu"]["rawLongTrades"] = len(_CAPTURE["long_raw"])
    payload["pengu"]["rawShortTrades"] = len(_CAPTURE["short_raw"])
    payload["assumptions"]["tradeGeneration"] = "Independent Long/Short generation, then no-overlap combine with Short priority"
    payload["assumptions"]["largeWaveProfitTreatment"] = (
        "Positive PENGU net returns overlapping fixed large-wave events are set to zero; losses and costs remain."
    )
    payload = base.rounded(payload)
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    core = payload["core"]["full"]
    p2 = payload["pengu"]["gross2Full"]
    conservative_metric = payload["combined"]["conservativeNoLargeWaveProfit"]
    conservative_severe_metric = payload["combined"]["conservativeNoLargeWaveProfitSevere"]
    mechanical = payload["combined"]["fullCorePeriod"]
    mechanical_severe = payload["combined"]["severeFullCorePeriod"]
    w24 = payload["largeWaveAudit"]["wave24h20pct"]
    w72 = payload["largeWaveAudit"]["wave72h35pct"]
    report = [
        "# V35 Core + PENGU V46 Gross 2.0 Backtest V2",
        "",
        "- Fixed historical PENGU 17 trades: **NOT USED**",
        "- PENGU trade generation: independent Long/Short, no overlap, Short priority",
        "- PENGU Gross: **2.0**",
        "- Total Gross cap: **NOT APPLIED**",
        f"- Large-wave profit trades excluded from conservative result: **{payload['combined']['excludedLargeWaveProfitTrades']}**",
        "",
        "## Conservative result (large-wave profits excluded)",
        "",
        f"- Return: {conservative_metric['compoundedReturnPct']}%",
        f"- CAGR: {conservative_metric['cagrPct']}%",
        f"- Max DD: {conservative_metric['maxDrawdownPct']}%",
        f"- Severe return: {conservative_severe_metric['compoundedReturnPct']}%",
        f"- Severe DD: {conservative_severe_metric['maxDrawdownPct']}%",
        "",
        "## Mechanical reference (all generated V46 trades included)",
        "",
        f"- Core only: {core['compoundedReturnPct']}% / CAGR {core['cagrPct']}% / DD {core['maxDrawdownPct']}%",
        f"- PENGU Gross 2.0: {p2['compoundedReturnPct']}% / PF {p2['profitFactor']} / DD {p2['maxDrawdownPct']}% / N {p2['trades']}",
        f"- Combined: {mechanical['compoundedReturnPct']}% / CAGR {mechanical['cagrPct']}% / DD {mechanical['maxDrawdownPct']}%",
        f"- Combined Severe: {mechanical_severe['compoundedReturnPct']}% / DD {mechanical_severe['maxDrawdownPct']}%",
        f"- Observed max concurrent Gross: {mechanical['observedMaxConcurrentGross']}",
        "",
        "## Large-wave capture",
        "",
        f"- 24h >=20%: {w24['capturedEvents']}/{w24['events']} captured; early {w24['earlyCapturedEvents']}/{w24['events']}",
        f"- 72h >=35%: {w72['capturedEvents']}/{w72['events']} captured; early {w72['earlyCapturedEvents']}/{w72['events']}",
        "",
        "- Production changed: NO",
        "- Real trading: DISABLED",
    ]
    (state_dir / "v35-core-pengu-v46-gross2-bt.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
