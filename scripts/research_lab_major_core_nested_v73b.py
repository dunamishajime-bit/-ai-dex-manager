from __future__ import annotations

import json
import os
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

import research_lab_major_core_nested_v73 as v73

SIGNAL_FALLBACKS: List[dict] = []
RISK_FALLBACKS: List[dict] = []
_ORIGINAL_SIGNAL_SELECT = v73.select_signal_members
_ORIGINAL_RISK_SELECT = v73.select_risk


def signal_score(config: v73.SignalConfig, normal: dict, severe: dict, validation: dict, validation_severe: dict) -> tuple:
    return (
        validation_severe["compoundedReturnPct"],
        validation["compoundedReturnPct"],
        validation["maxDrawdownPct"],
        severe["compoundedReturnPct"],
        normal["compoundedReturnPct"],
        -config.top_k,
        -config.rebalance_days,
    )


def conservative_signal_fallback(
    configs: Sequence[v73.SignalConfig],
    rows_by_id: dict,
    severe_by_id: dict,
    train_start: int,
    validation_start: int,
    validation_end: int,
) -> List[v73.SignalConfig]:
    strict = _ORIGINAL_SIGNAL_SELECT(
        configs,
        rows_by_id,
        severe_by_id,
        train_start,
        validation_start,
        validation_end,
    )
    if strict:
        SIGNAL_FALLBACKS.append({"used": False, "members": [item.config_id for item in strict]})
        return strict

    evaluated: List[Tuple[tuple, v73.SignalConfig, dict]] = []
    eligible: List[v73.SignalConfig] = []
    for config in configs:
        dev = v73.metrics(rows_by_id[config.config_id], train_start, validation_start)
        dev_severe = v73.metrics(severe_by_id[config.config_id], train_start, validation_start)
        val = v73.metrics(rows_by_id[config.config_id], validation_start, validation_end)
        val_severe = v73.metrics(severe_by_id[config.config_id], validation_start, validation_end)
        evidence = {
            "development": dev,
            "developmentSevere": dev_severe,
            "validation": val,
            "validationSevere": val_severe,
        }
        evaluated.append((signal_score(config, dev, dev_severe, val, val_severe), config, evidence))
        if (
            dev["compoundedReturnPct"] > 0
            and val["compoundedReturnPct"] > 0
            and dev["maxDrawdownPct"] >= -35
            and val["maxDrawdownPct"] >= -22
            and dev_severe["compoundedReturnPct"] >= -20
            and val_severe["compoundedReturnPct"] >= -12
        ):
            eligible.append(config)

    stable = [
        config
        for config in eligible
        if sum(v73.signal_neighbor(config, other) for other in eligible if other != config) >= 1
    ]
    pool = stable or eligible
    pool_ids = {item.config_id for item in pool}
    ranked = [item for item in evaluated if item[1].config_id in pool_ids]
    if not ranked:
        ranked = [
            item
            for item in evaluated
            if item[2]["development"]["compoundedReturnPct"] > 0
            and item[2]["validation"]["compoundedReturnPct"] > 0
        ]
    ranked.sort(key=lambda item: item[0], reverse=True)

    selected: List[v73.SignalConfig] = []
    used_regimes = set()
    for _score, config, _evidence in ranked:
        diversity_key = (config.regime_days, config.momentum_days, config.rebalance_days)
        if diversity_key in used_regimes and len(selected) < 3:
            continue
        selected.append(config)
        used_regimes.add(diversity_key)
        if len(selected) >= 5:
            break
    if len(selected) < 3:
        selected = [item[1] for item in ranked[:5]]
    if not selected:
        selected = [
            v73.SignalConfig(60, 30, 20, 1, 2),
            v73.SignalConfig(90, 45, 40, 1, 4),
            v73.SignalConfig(120, 60, 60, 2, 6),
        ]

    SIGNAL_FALLBACKS.append({
        "used": True,
        "eligible": len(eligible),
        "stable": len(stable),
        "members": [item.config_id for item in selected],
        "note": "Fallback is selected only from the inner Development/Validation data; outer test data remains untouched.",
    })
    return selected


def risk_score(risk: v73.RiskConfig, dev: dict, severe: dict, val: dict, val_severe: dict) -> tuple:
    return (
        val_severe["compoundedReturnPct"],
        val["compoundedReturnPct"],
        val["maxDrawdownPct"],
        severe["compoundedReturnPct"],
        -risk.bull_gross,
        -risk.bear_gross,
        risk.stop_atr,
        -risk.max_symbol_gross,
    )


def conservative_risk_fallback(
    risks: Sequence[v73.RiskConfig],
    rows_by_id: dict,
    severe_by_id: dict,
    train_start: int,
    validation_start: int,
    validation_end: int,
) -> Optional[v73.RiskConfig]:
    strict = _ORIGINAL_RISK_SELECT(
        risks,
        rows_by_id,
        severe_by_id,
        train_start,
        validation_start,
        validation_end,
    )
    if strict is not None:
        RISK_FALLBACKS.append({"used": False, "risk": strict.config_id})
        return strict

    evaluated = []
    eligible: List[v73.RiskConfig] = []
    for risk in risks:
        dev = v73.metrics(rows_by_id[risk.config_id], train_start, validation_start)
        dev_severe = v73.metrics(severe_by_id[risk.config_id], train_start, validation_start)
        val = v73.metrics(rows_by_id[risk.config_id], validation_start, validation_end)
        val_severe = v73.metrics(severe_by_id[risk.config_id], validation_start, validation_end)
        evaluated.append((risk_score(risk, dev, dev_severe, val, val_severe), risk))
        if (
            dev["compoundedReturnPct"] > 0
            and val["compoundedReturnPct"] > 0
            and dev["maxDrawdownPct"] >= -35
            and val["maxDrawdownPct"] >= -22
            and dev_severe["compoundedReturnPct"] >= -20
            and val_severe["compoundedReturnPct"] >= -12
        ):
            eligible.append(risk)

    stable = [
        risk
        for risk in eligible
        if sum(v73.risk_neighbor(risk, other) for other in eligible if other != risk) >= 1
    ]
    pool_ids = {item.config_id for item in (stable or eligible)}
    ranked = [item for item in evaluated if item[1].config_id in pool_ids]
    ranked.sort(key=lambda item: item[0], reverse=True)
    if ranked:
        top = ranked[: max(1, min(12, len(ranked)))]
        candidates = [item[1] for item in top]
        candidates.sort(key=lambda item: (
            item.bull_gross,
            item.bear_gross,
            item.max_symbol_gross,
            -item.stop_atr,
            item.target_vol_pct,
            -item.dd_brake_start,
        ))
        selected = candidates[0]
    else:
        selected = v73.base_risk()

    RISK_FALLBACKS.append({
        "used": True,
        "eligible": len(eligible),
        "stable": len(stable),
        "risk": selected.config_id,
        "note": "Fallback chooses the lowest-Gross member among the best inner-validation candidates; final OOS and statistical gates are unchanged.",
    })
    return selected


def append_fallback_evidence() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    json_path = state_dir / "major-core-nested-v73.json"
    payload = json.loads(json_path.read_text(encoding="utf-8"))
    payload["version"] = "73b"
    payload["strategyId"] = "MAJOR_CORE_NESTED_V73B"
    payload["innerSelectionFallback"] = {
        "signalFolds": SIGNAL_FALLBACKS,
        "riskFolds": RISK_FALLBACKS,
        "finalRobustPassCriteriaChanged": False,
    }
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    md_path = state_dir / "major-core-nested-v73.md"
    with md_path.open("a", encoding="utf-8") as handle:
        handle.write("\n\n## Inner-selection fallback audit\n\n")
        handle.write(f"- Signal fallbacks used: {sum(item.get('used', False) for item in SIGNAL_FALLBACKS)}/{len(SIGNAL_FALLBACKS)}\n")
        handle.write(f"- Risk fallbacks used: {sum(item.get('used', False) for item in RISK_FALLBACKS)}/{len(RISK_FALLBACKS)}\n")
        handle.write("- Outer OOS, DSR, Reality Check, SPA and permutation pass criteria are unchanged.\n")


def main() -> None:
    v73.select_signal_members = conservative_signal_fallback
    v73.select_risk = conservative_risk_fallback
    v73.main()
    append_fallback_evidence()


if __name__ == "__main__":
    main()
