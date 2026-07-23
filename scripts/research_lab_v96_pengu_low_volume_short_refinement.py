from __future__ import annotations

import datetime as dt
import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import List, Optional

import research_lab_v35_core_pengu_v46_gross2 as pv46
import research_lab_v35_core_pengu_v67_v69_sizing as v69
import research_lab_v96_frequency_uplift as freq
import research_lab_v96_pengu_volume_floor_validation as val

core = v69.core


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    short_volume_floor: float = 0.80
    short_mom6_max: float = 0.00
    breakdown_buffer_pct: float = 0.00
    require_btc_weak: bool = False


CANDIDATES = [
    Candidate("BASE"),
    Candidate("SHORT_VOL70", short_volume_floor=0.70),
    Candidate("SHORT_VOL65", short_volume_floor=0.65),
    Candidate("SHORT_VOL60", short_volume_floor=0.60),
    Candidate("SHORT_VOL60_MOM05", short_volume_floor=0.60, short_mom6_max=-0.50),
    Candidate("SHORT_VOL60_MOM10", short_volume_floor=0.60, short_mom6_max=-1.00),
    Candidate("SHORT_VOL60_BREAK025", short_volume_floor=0.60, breakdown_buffer_pct=0.25),
    Candidate("SHORT_VOL60_BREAK050", short_volume_floor=0.60, breakdown_buffer_pct=0.50),
    Candidate("SHORT_VOL60_BTC_WEAK", short_volume_floor=0.60, require_btc_weak=True),
    Candidate("SHORT_VOL60_MOM05_BREAK025", short_volume_floor=0.60, short_mom6_max=-0.50, breakdown_buffer_pct=0.25),
    Candidate("SHORT_VOL65_MOM05", short_volume_floor=0.65, short_mom6_max=-0.50),
]


def latest_funding(points: List[dict], ts: int) -> Optional[float]:
    latest: Optional[float] = None
    for row in points:
        if int(row["ts"]) > ts:
            break
        latest = float(row["rate"])
    return latest


def build_trades(candidate: Candidate, pengu: List[dict], btc: List[dict], funding: List[dict]) -> List[pv46.Trade]:
    p_map = {int(row["ts"]): index for index, row in enumerate(pengu)}
    b_map = {int(row["ts"]): index for index, row in enumerate(btc)}
    common = sorted(set(p_map) & set(b_map))
    p_close = [float(row["close"]) for row in pengu]
    p_volume = [float(row["volume"]) for row in pengu]
    b_close = [float(row["close"]) for row in btc]
    p_sma72 = pv46.rolling_mean(p_close, 72)
    p_sma168 = pv46.rolling_mean(p_close, 168)
    b_sma168 = pv46.rolling_mean(b_close, 168)
    p_mom6 = pv46.momentum(p_close, 6)
    p_mom24 = pv46.momentum(p_close, 24)
    p_mom48 = pv46.momentum(p_close, 48)
    p_mom120 = pv46.momentum(p_close, 120)
    b_mom48 = pv46.momentum(b_close, 48)
    b_mom72 = pv46.momentum(b_close, 72)
    b_mom120 = pv46.momentum(b_close, 120)
    p_rsi14 = pv46.rsi(p_close, 14)
    p_vol_ratio = pv46.volume_ratio(p_volume, 12, 72)
    trades: List[pv46.Trade] = []
    next_free = 0
    for ts in common:
        if ts < next_free or (ts // pv46.HOUR) % pv46.DECISION_HOURS != 0:
            continue
        pi = p_map[ts]
        bi = b_map[ts]
        if pi < 220 or bi < 220 or pi + 25 >= len(pengu):
            continue
        p_now = p_close[pi]
        b_now = b_close[bi]
        vol = p_vol_ratio[pi]
        if vol is None:
            continue
        prior_lows = [float(row["low"]) for row in pengu[pi - 24:pi]]
        prior_low = min(prior_lows) if prior_lows else None
        btc_weak = bool(
            b_sma168[bi] is not None
            and b_mom72[bi] is not None
            and (b_now < b_sma168[bi] or b_mom72[bi] <= 0.0)
        )
        short_signal = bool(
            vol >= candidate.short_volume_floor
            and prior_low is not None
            and p_mom6[pi] is not None
            and p_now < prior_low * (1.0 - candidate.breakdown_buffer_pct / 100.0)
            and p_mom6[pi] < candidate.short_mom6_max
            and pv46.btc_risk(-1, b_now, b_sma168[bi], b_mom72[bi])
            and (not candidate.require_btc_weak or btc_weak)
        )
        decision_close_ts = ts + pv46.HOUR - 1
        funding_now = latest_funding(funding, decision_close_ts)
        slope_index = pi - 48
        prior_mom_index = pi - 12
        long_signal = bool(
            not short_signal
            and vol >= 0.80
            and funding_now is not None
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
            and pv46.btc_risk(1, b_now, b_sma168[bi], b_mom72[bi])
        )
        side = -1 if short_signal else 1 if long_signal else 0
        if side == 0:
            continue
        entry_index = pi + 1
        exit_index = entry_index + 24
        entry_ts = int(pengu[entry_index]["ts"])
        exit_ts = int(pengu[exit_index]["ts"])
        entry_price = float(pengu[entry_index]["open"])
        exit_price = float(pengu[exit_index]["open"])
        gross_pct = side * (exit_price / entry_price - 1.0) * 100.0
        paid_funding = side * pv46.funding_between(funding, entry_ts, exit_ts)
        base_pct = gross_pct - paid_funding - val.NORMAL_TOTAL_COST_PCT
        severe_pct = gross_pct - paid_funding - val.SEVERE_TOTAL_COST_PCT
        trades.append(pv46.Trade(entry_ts, exit_ts, side, entry_price, exit_price, gross_pct, paid_funding, base_pct, severe_pct, ts))
        next_free = exit_ts
    return trades


def evaluate(candidate: Candidate, pengu: List[dict], btc: List[dict], funding: List[dict]) -> dict:
    trades = build_trades(candidate, pengu, btc, funding)
    no_best = val.remove_best_trade(trades)
    no_month = val.remove_best_month(trades)
    year2025_start = int(dt.datetime(2025, 1, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)
    year2026_start = int(dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)
    return {
        "candidate": asdict(candidate),
        "full": val.trade_metrics(trades, freq.PENGU_START, core.CORE_END, val.NORMAL_TOTAL_COST_PCT),
        "fullSevere": val.trade_metrics(trades, freq.PENGU_START, core.CORE_END, val.SEVERE_TOTAL_COST_PCT),
        "fullExtreme": val.trade_metrics(trades, freq.PENGU_START, core.CORE_END, val.EXTREME_TOTAL_COST_PCT),
        "year2025": val.trade_metrics(trades, year2025_start, year2026_start, val.NORMAL_TOTAL_COST_PCT),
        "year2025Severe": val.trade_metrics(trades, year2025_start, year2026_start, val.SEVERE_TOTAL_COST_PCT),
        "year2026": val.trade_metrics(trades, year2026_start, core.CORE_END, val.NORMAL_TOTAL_COST_PCT),
        "year2026Severe": val.trade_metrics(trades, year2026_start, core.CORE_END, val.SEVERE_TOTAL_COST_PCT),
        "removeBestTradeSevere": val.trade_metrics(no_best, freq.PENGU_START, core.CORE_END, val.SEVERE_TOTAL_COST_PCT),
        "removeBestMonthSevere": val.trade_metrics(no_month, freq.PENGU_START, core.CORE_END, val.SEVERE_TOTAL_COST_PCT),
    }


def passes(item: dict, baseline: dict) -> bool:
    return bool(
        item["full"]["trades"] >= baseline["full"]["trades"] + 3
        and item["full"]["returnPct"] > baseline["full"]["returnPct"]
        and item["fullSevere"]["returnPct"] > baseline["fullSevere"]["returnPct"]
        and item["full"]["maxDrawdownPct"] >= baseline["full"]["maxDrawdownPct"] - 1.0
        and item["fullSevere"]["maxDrawdownPct"] >= baseline["fullSevere"]["maxDrawdownPct"] - 1.0
        and item["year2025"]["returnPct"] >= baseline["year2025"]["returnPct"]
        and item["year2025Severe"]["returnPct"] >= baseline["year2025Severe"]["returnPct"]
        and item["year2026"]["returnPct"] >= baseline["year2026"]["returnPct"]
        and item["year2026Severe"]["returnPct"] >= baseline["year2026Severe"]["returnPct"]
        and item["removeBestTradeSevere"]["returnPct"] > 0
        and item["removeBestMonthSevere"]["returnPct"] > 0
    )


def rounded(value):
    if isinstance(value, float):
        return round(value, 4)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    pengu = pv46.fetch_klines("PENGUUSDT", freq.PENGU_START, core.CORE_END)
    btc = pv46.fetch_klines("BTCUSDT", freq.PENGU_START, core.CORE_END)
    funding = pv46.fetch_funding("PENGUUSDT", freq.PENGU_START, core.CORE_END)
    results = [evaluate(candidate, pengu, btc, funding) for candidate in CANDIDATES]
    baseline = next(item for item in results if item["candidate"]["candidate_id"] == "BASE")
    for item in results:
        item["pass"] = False if item is baseline else passes(item, baseline)
    passed = [item["candidate"]["candidate_id"] for item in results if item["pass"]]
    status = "LOW_VOLUME_SHORT_REFINEMENT_FOUND" if passed else "NO_ROBUST_LOW_VOLUME_SHORT_REFINEMENT"
    payload = rounded({
        "version": 1,
        "strategyId": "PENGU_V46_LOW_VOLUME_SHORT_REFINEMENT_V1",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "passed": passed,
        "results": results,
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
        },
        "limitations": [
            "These candidates were motivated by the observed 2025/2026 split of the volume-floor 0.60 lead.",
            "No candidate is independent holdout evidence.",
            "Any surviving candidate remains Shadow-only and requires a new Forward clock.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v96-pengu-low-volume-short-refinement.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    report = [
        "# V96 PENGU Low-volume Short Refinement",
        "",
        f"- Status: **{status}**",
        f"- Passed: {', '.join(passed) if passed else 'NONE'}",
        "- Production / LIVE / VPS / orders changed: **NO**",
        "",
        "| Candidate | Trades | Full | Severe | 2025 | 2025 severe | 2026 | 2026 severe | Best trade removed severe | Pass |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for item in payload["results"]:
        report.append(
            f"| {item['candidate']['candidate_id']} | {item['full']['trades']} | {item['full']['returnPct']}% | "
            f"{item['fullSevere']['returnPct']}% | {item['year2025']['returnPct']}% | {item['year2025Severe']['returnPct']}% | "
            f"{item['year2026']['returnPct']}% | {item['year2026Severe']['returnPct']}% | "
            f"{item['removeBestTradeSevere']['returnPct']}% | {'YES' if item['pass'] else 'NO'} |"
        )
    (state_dir / "v96-pengu-low-volume-short-refinement.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
