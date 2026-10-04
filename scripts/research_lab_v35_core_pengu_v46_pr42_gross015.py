from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Dict, List

import research_lab_v35_core_pengu_v46_gross2 as base
import research_lab_v35_core_pengu_v46_gross2_v2 as v2

OUTPUT_STEM = "v35-core-pengu-v46-pr42-gross015-bt"
ORIGINAL_COMBO_TARGETS = base.v28.combo_targets


def target_key(target: Dict[str, float]) -> str:
    return "|".join(sorted(
        f"{symbol}:{1 if float(value) > 0 else -1}"
        for symbol, value in target.items()
        if abs(float(value)) > 0.05
    ))


def confirmed_combo_targets(*args, **kwargs):
    candidates = ORIGINAL_COMBO_TARGETS(*args, **kwargs)
    accepted_key = ""
    pending_key = ""
    pending_count = 0
    accepted_target: Dict[str, float] = {}
    result: Dict[int, Dict[str, float]] = {}
    for ts in sorted(candidates):
        candidate = dict(candidates.get(ts, {}))
        key = target_key(candidate)
        if not accepted_key:
            accepted_key = key
            accepted_target = candidate
        elif key == accepted_key:
            pending_key = ""
            pending_count = 0
            accepted_target = candidate
        else:
            if key == pending_key:
                pending_count += 1
            else:
                pending_key = key
                pending_count = 1
            if pending_count >= 2:
                accepted_key = key
                pending_key = ""
                pending_count = 0
                accepted_target = candidate
        result[ts] = dict(accepted_target)
    return result


def latest_build_pengu_trades(pengu: List[dict], btc: List[dict], funding: List[dict]) -> List[base.Trade]:
    v2._CAPTURE["pengu_rows"] = pengu
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

    trades: List[base.Trade] = []
    raw_long: List[base.Trade] = []
    raw_short: List[base.Trade] = []
    next_free = 0
    streak_side = 0
    streak_count = 0

    for ts in common:
        if ts < next_free or (ts // base.HOUR) % base.DECISION_HOURS != 0:
            continue
        pi = p_map[ts]
        bi = b_map[ts]
        if pi < 220 or bi < 220 or pi + 25 >= len(pengu):
            continue
        p_now = p_close[pi]
        b_now = b_close[bi]
        vol = p_vol_ratio[pi]
        mom6 = p_mom6[pi]
        edge_sufficient = mom6 is not None and abs(mom6) >= 0.8

        prior_lows = [float(row["low"]) for row in pengu[pi - 24:pi]]
        short_signal = bool(
            edge_sufficient
            and vol is not None and vol >= 0.8
            and prior_lows
            and p_now < min(prior_lows)
            and mom6 is not None and mom6 < 0.0
            and base.btc_risk(-1, b_now, b_sma168[bi], b_mom72[bi])
        )

        funding_now = base.latest_funding(funding, ts + base.HOUR - 1)
        slope_index = pi - 48
        prior_mom_index = pi - 12
        long_signal = bool(
            edge_sufficient
            and vol is not None and vol >= 0.8
            and funding_now is not None and funding_now <= 0.0003
            and p_sma72[pi] is not None and p_sma168[pi] is not None
            and slope_index >= 0 and p_sma168[slope_index] is not None
            and mom6 is not None and prior_mom_index >= 0
            and p_mom6[prior_mom_index] is not None
            and p_mom24[pi] is not None and p_mom48[pi] is not None
            and p_mom120[pi] is not None and b_mom48[bi] is not None
            and b_mom120[bi] is not None and p_rsi14[pi] is not None
            and p_now > p_sma72[pi] and p_now > p_sma168[pi]
            and p_sma168[pi] > p_sma168[slope_index]
            and mom6 > 1.0 and p_mom6[prior_mom_index] <= 0.0
            and p_mom24[pi] > 0.0 and p_mom120[pi] > 2.0
            and p_mom48[pi] - b_mom48[bi] > 1.0
            and p_mom120[pi] - b_mom120[bi] > 0.0
            and 45.0 <= p_rsi14[pi] <= 72.0
            and base.btc_risk(1, b_now, b_sma168[bi], b_mom72[bi])
        )
        side = -1 if short_signal else 1 if long_signal else 0
        if side == 0:
            streak_side = 0
            streak_count = 0
            continue
        if side == streak_side:
            streak_count += 1
        else:
            streak_side = side
            streak_count = 1
        if streak_count < 2:
            continue

        entry_index = pi + 1
        exit_index = entry_index + 24
        entry_ts = int(pengu[entry_index]["ts"])
        exit_ts = int(pengu[exit_index]["ts"])
        entry_price = float(pengu[entry_index]["open"])
        exit_price = float(pengu[exit_index]["open"])
        gross_pct = side * (exit_price / entry_price - 1.0) * 100.0
        paid_funding = side * base.funding_between(funding, entry_ts, exit_ts)
        trade = base.Trade(
            entry_ts=entry_ts,
            exit_ts=exit_ts,
            side=side,
            entry_price=entry_price,
            exit_price=exit_price,
            gross_pct=gross_pct,
            funding_pct=paid_funding,
            base_pct=gross_pct - paid_funding - 0.12 - 0.02,
            severe_pct=gross_pct - paid_funding - 0.20 - 0.05,
            signal_ts=ts,
        )
        trades.append(trade)
        (raw_short if side < 0 else raw_long).append(trade)
        next_free = exit_ts + 12 * base.HOUR
        streak_side = 0
        streak_count = 0

    v2._CAPTURE["trades"] = trades
    v2._CAPTURE["long_raw"] = raw_long
    v2._CAPTURE["short_raw"] = raw_short
    return trades


def main() -> None:
    base.PENGU_GROSS = 0.15
    base.v28.combo_targets = confirmed_combo_targets
    v2.corrected_build_pengu_trades = latest_build_pengu_trades
    v2._CAPTURE.clear()
    v2.main()

    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    old_json = state_dir / "v35-core-pengu-v46-gross2-bt.json"
    payload = json.loads(old_json.read_text(encoding="utf-8"))
    payload["version"] = "pr42-gross015-v1"
    payload["strategyId"] = "DISDEX_V35_CORE_PLUS_PENGU_V46_PR42_GROSS015_BT"
    payload["status"] = "RESEARCH_ONLY_PR42_SYNC_LOGIC"
    payload["assumptions"].update({
        "penguGross": 0.15,
        "sourceLogic": "GitHub PR #42 head ec936dfab9d2ec3151a7b7f5b310c4e6d2128784",
        "coreTargetConfirmationBars": 2,
        "penguConfirmationDecisionBars": 2,
        "penguReentryCooldownHours": 12,
        "penguMinimumRoundTripEdgeBps": 80,
        "fixedHistoricalPengu17TradesUsed": False,
    })
    new_json = state_dir / f"{OUTPUT_STEM}.json"
    new_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    conservative = payload["combined"]["conservativeNoLargeWaveProfit"]
    conservative_severe = payload["combined"]["conservativeNoLargeWaveProfitSevere"]
    mechanical = payload["combined"]["fullCorePeriod"]
    mechanical_severe = payload["combined"]["severeFullCorePeriod"]
    pengu = payload["pengu"]["gross2Full"]
    core = payload["core"]["full"]
    w24 = payload["largeWaveAudit"]["wave24h20pct"]
    w72 = payload["largeWaveAudit"]["wave72h35pct"]
    report = [
        "# V35 Core + PENGU V46 PR42 Logic Gross 0.15 Backtest",
        "",
        "- Source logic: PR #42 VPS sync",
        "- Fixed historical PENGU 17 trades: **NOT USED**",
        "- Core target confirmation: 2 bars",
        "- PENGU confirmation: 2 decision bars",
        "- PENGU re-entry cooldown: 12h",
        "- PENGU minimum edge: 80bps",
        "- PENGU Gross: **0.15**",
        "",
        "## Conservative — large-wave PENGU profits excluded",
        f"- Return: {conservative['compoundedReturnPct']}%",
        f"- CAGR: {conservative['cagrPct']}%",
        f"- Max DD: {conservative['maxDrawdownPct']}%",
        f"- Severe return: {conservative_severe['compoundedReturnPct']}%",
        f"- Severe Max DD: {conservative_severe['maxDrawdownPct']}%",
        "",
        "## Mechanical — all generated trades included",
        f"- Core only: {core['compoundedReturnPct']}% / CAGR {core['cagrPct']}% / DD {core['maxDrawdownPct']}%",
        f"- PENGU 0.15: {pengu['compoundedReturnPct']}% / PF {pengu['profitFactor']} / DD {pengu['maxDrawdownPct']}% / N {pengu['trades']}",
        f"- Combined: {mechanical['compoundedReturnPct']}% / CAGR {mechanical['cagrPct']}% / DD {mechanical['maxDrawdownPct']}%",
        f"- Combined Severe: {mechanical_severe['compoundedReturnPct']}% / DD {mechanical_severe['maxDrawdownPct']}%",
        f"- Observed max concurrent Gross: {mechanical['observedMaxConcurrentGross']}",
        "",
        "## Large-wave capture",
        f"- 24h >=20%: {w24['capturedEvents']}/{w24['events']} captured; early {w24['earlyCapturedEvents']}/{w24['events']}",
        f"- 72h >=35%: {w72['capturedEvents']}/{w72['events']} captured; early {w72['earlyCapturedEvents']}/{w72['events']}",
        "",
        "- Production changed: NO",
        "- LIVE settings changed: NO",
    ]
    new_md = state_dir / f"{OUTPUT_STEM}.md"
    new_md.write_text("\n".join(report), encoding="utf-8")
    print("\n".join(report))


if __name__ == "__main__":
    main()
