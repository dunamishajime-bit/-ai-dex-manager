from __future__ import annotations

import datetime
import hashlib
import json
import os
import re
from pathlib import Path

import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_asymmetric_bear_hedge_v5 as v5
import research_lab_precomputed_multi_regime_v6 as v6
import research_lab_fixed_candidate_robustness_v7 as v7

DATA_START = 1767225600000  # 2026-01-01 UTC
FORWARD_START = 1782864000000  # 2026-07-01 UTC
SYMBOLS = ["BTC", "ETH", "BNB", "SOL", "LINK", "AVAX"]

COMPONENTS = [
    v4.Component("MH_12H_LONG_CASH_CORE3_R30_M10_B3.5_K1", 30, 10, 3.5, 1),
    v4.Component("MH_12H_LONG_CASH_CORE3_R30_M10_B5.5_K1", 30, 10, 5.5, 1),
    v4.Component("MH_12H_LONG_CASH_CORE3_R42_M10_B3.5_K1", 42, 10, 3.5, 1),
    v4.Component("MH_12H_LONG_CASH_CORE3_R30_M30_B3.5_K2", 30, 30, 3.5, 2),
    v4.Component("MH_12H_LONG_CASH_CORE3_R42_M30_B3.5_K2", 42, 30, 3.5, 2),
    v4.Component("MH_12H_LONG_CASH_CORE3_R30_M10_B3.5_K2", 30, 10, 3.5, 2),
    v4.Component("MH_12H_LONG_CASH_CORE3_R30_M10_B5.5_K2", 30, 10, 5.5, 2),
    v4.Component("MH_12H_LONG_CASH_CORE3_R30_M20_B3.5_K2", 30, 20, 3.5, 2),
    v4.Component("MH_12H_LONG_CASH_CORE3_R42_M10_B3.5_K2", 42, 10, 3.5, 2),
    v4.Component("MH_12H_LONG_CASH_CORE3_R42_M20_B3.5_K2", 42, 20, 3.5, 2),
]
OVERLAY = v4.Overlay("BAG_V50_S0_TV45_G1.1_CNONE", 0.5, 0, 45, 1.1, None)
HEDGE = v5.Hedge("H_BTC_S60_M30_G0.4", 60, 30, 0.4, "BTC")
CONFIRM_BARS = 4


def load_latest_symbol(cache_root: Path, symbol: str) -> tuple[dict, int]:
    pattern = re.compile(rf"^{symbol}USDT-{DATA_START}-(\d+)-v\d+\.json$")
    candidates: list[tuple[int, Path]] = []
    for target in (cache_root / "consolidated").glob(f"{symbol}USDT-{DATA_START}-*-v*.json"):
        match = pattern.match(target.name)
        if match:
            candidates.append((int(match.group(1)), target))
    if not candidates:
        raise FileNotFoundError(f"fresh forward cache missing for {symbol}")
    end_ts, target = max(candidates, key=lambda item: item[0])
    return json.loads(target.read_text(encoding="utf-8")), end_ts


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
    cache_root = Path.cwd() / ".cache" / "perp-research-usdm"
    loaded = {symbol: load_latest_symbol(cache_root, symbol) for symbol in SYMBOLS}
    raw = {symbol: loaded[symbol][0] for symbol in SYMBOLS}
    forward_end = min(loaded[symbol][1] for symbol in SYMBOLS)
    bars = {symbol: v4.resample_12h(raw[symbol]["candles"]) for symbol in SYMBOLS}
    indexes = {symbol: {int(bar["ts"]): index for index, bar in enumerate(rows)} for symbol, rows in bars.items()}
    funding = v6.funding_buckets({symbol: raw[symbol]["funding"] for symbol in SYMBOLS})
    times = [int(bar["ts"]) for bar in bars["BTC"] if DATA_START <= int(bar["ts"]) < forward_end]
    projected = v6.precompute_projected_members(COMPONENTS, times, bars, indexes)
    base_targets = v6.precompute_base_targets([OVERLAY], times, projected, bars, indexes)
    bear_targets = v6.precompute_bear_targets([HEDGE], times, bars, indexes)
    targets = v7.desired_targets(OVERLAY, HEDGE, CONFIRM_BARS, times, base_targets, bear_targets)
    forward_signal_bars = sum(1 for ts in times if ts >= FORWARD_START and v4.gross_exposure(targets.get(ts, {})) > 0)
    scenarios = [
        v7.ExecutionScenario("NORMAL_10BPS", 10, 0, 0),
        v7.ExecutionScenario("STRESS_30BPS", 30, 0, 0),
        v7.ExecutionScenario("SEVERE_50BPS_DELAY12H_FUND3", 50, 1, 3),
    ]
    results = {
        scenario.scenario_id: v7.simulate_scenario(
            scenario, targets, times, bars, indexes, funding, FORWARD_START, forward_end,
        )
        for scenario in scenarios
    }
    normal = results["NORMAL_10BPS"]
    stress = results["STRESS_30BPS"]
    severe = results["SEVERE_50BPS_DELAY12H_FUND3"]
    cycles = normal["cycles"]
    positive = cycles > 0 and (
        normal["compoundedReturnPct"] > 0
        and stress["compoundedReturnPct"] > 0
        and (normal["profitFactor"] or 0) >= 1
        and (stress["profitFactor"] or 0) >= 1
        and severe["compoundedReturnPct"] >= -3
    )
    if cycles == 0:
        status = "NO_FORWARD_SIGNAL"
    elif positive:
        status = "FRESH_FORWARD_POSITIVE_PRELIMINARY"
    else:
        status = "FRESH_FORWARD_NEGATIVE"
    sample_status = "FORWARD_SAMPLE_BUILDING" if cycles < 30 else ("PAPER_REVIEW_ELIGIBLE" if positive else "FORWARD_REJECTED")
    start_label = datetime.datetime.fromtimestamp(FORWARD_START / 1000, tz=datetime.timezone.utc).date().isoformat()
    end_label = datetime.datetime.fromtimestamp(forward_end / 1000, tz=datetime.timezone.utc).date().isoformat()
    result = rounded({
        "version": 9,
        "strategyId": "FROZEN_V6_FRESH_FORWARD_V9",
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "status": status,
        "sampleStatus": sample_status,
        "frozenBeforeForward": True,
        "frozenVariant": {
            "components": [component.__dict__ for component in COMPONENTS],
            "overlay": OVERLAY.__dict__,
            "hedge": HEDGE.__dict__,
            "confirmBars": CONFIRM_BARS,
        },
        "period": {"start": FORWARD_START, "end": forward_end},
        "forwardSignalBars": forward_signal_bars,
        "scenarios": results,
        "positivePreliminary": positive,
        "paperEligible": positive and cycles >= 30,
        "liveEligible": False,
        "productionChanged": False,
        "realTradingEnabled": False,
        "liveBlockReasons": [
            f"Fresh Forward cycles {cycles}/100",
            "Aster実約定Spread/Slippage未検証",
            "通貨別Forward件数未達",
            "CIO承認前",
        ],
        "fingerprint": hashlib.sha256(json.dumps({
            "components": [component.__dict__ for component in COMPONENTS],
            "overlay": OVERLAY.__dict__,
            "hedge": HEDGE.__dict__,
            "confirm": CONFIRM_BARS,
            "period": [FORWARD_START, forward_end],
            "scenarios": [scenario.__dict__ for scenario in scenarios],
        }, sort_keys=True).encode()).hexdigest(),
        "limitations": [
            "2026-07-01以降のみを、6月30日以前に固定したV6条件で評価する。",
            "サンプルが小さい間は正負どちらでもロジック確定とは判定しない。",
            "Forward 30 cyclesまではPaper審査対象にせず、100 cyclesまではLive禁止。",
            "本番コード、VPS、.env、実売買runnerは変更していない。",
        ],
    })
    if cycles == 0:
        verdict = "Fresh Forward期間はEntry条件が成立せず、現金待機でした。条件を変更せずサンプルを継続します。"
    elif positive:
        verdict = "Fresh Forwardは暫定プラスです。条件を変更せずサンプルを継続します。"
    else:
        verdict = "Fresh Forwardでマイナスとなりました。候補は採用せず監視を継続します。"
    report = [
        "# Frozen V6 Fresh Forward V9",
        "",
        f"- Status: **{status}**",
        f"- Sample status: **{sample_status}**",
        f"- Period: {start_label} through {end_label} UTC",
        f"- Forward signal bars: {forward_signal_bars}",
        f"- Forward cycles: {cycles}",
        f"- Paper eligible: **{'YES' if result['paperEligible'] else 'NO'}**",
        "- Production changed: NO",
        "- Real trading: DISABLED",
        "",
        "| Scenario | N | Win | Compound | PF | DD | Best share | PF ex-best |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        *[
            f"| {scenario.scenario_id} | {result['scenarios'][scenario.scenario_id]['cycles']} | {result['scenarios'][scenario.scenario_id]['winRatePct']}% | {result['scenarios'][scenario.scenario_id]['compoundedReturnPct']}% | {result['scenarios'][scenario.scenario_id]['profitFactor']} | {result['scenarios'][scenario.scenario_id]['maxDrawdownPct']}% | {result['scenarios'][scenario.scenario_id]['bestCycleProfitSharePct']}% | {result['scenarios'][scenario.scenario_id]['profitFactorWithoutBest']} |"
            for scenario in scenarios
        ],
        "",
        "## Verdict",
        "",
        verdict,
        "",
        "## Limitations",
        "",
        *[f"- {item}" for item in result["limitations"]],
    ]
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "frozen-v6-fresh-forward-v9.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "frozen-v6-fresh-forward-v9.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
