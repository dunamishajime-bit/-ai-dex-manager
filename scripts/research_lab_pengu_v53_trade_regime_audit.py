from __future__ import annotations

import csv
import datetime as dt
import json
import os
import statistics
from dataclasses import asdict
from pathlib import Path
from typing import List, Optional

import research_lab_pengu_wave_sleeve_v47 as v47
import research_lab_pengu_wave_sleeve_v50 as v50
import research_lab_pengu_wave_sleeve_v52 as v52

HOUR = v47.HOUR

REVERSAL = v52.Candidate(1, "REVERSAL", 6, 0.4, 1.5, 0.0, 0.3, 0.4, 9.0, 0.2, 1, "FAST")
COMPRESSION = v52.Candidate(1, "COMPRESSION", 12, 0.2, 0.3, 0.0, 0.8, 0.9, 0.6, 0.2, 3, "FAST")
FLASH = v52.Candidate(-1, "FLASH", 6, 1.5, 2.5, 0.0, 0.8, 0.7, 1.0, 0.2, 1, "WIDE")
DISTRIBUTION = v52.Candidate(-1, "DISTRIBUTION", 6, 0.7, 0.5, 1.5, 0.5, 0.6, 1.0, 0.2, 2, "FAST")


def fold_index(ts: int, folds: List[tuple[int, int]]) -> int:
    for index, (start, end) in enumerate(folds):
        if start <= ts < end:
            return index
    return -1


def prior_high_drawdown(rows: List[dict], index: int, length: int) -> Optional[float]:
    if index < length:
        return None
    high = max(float(row["high"]) for row in rows[index - length:index])
    close = float(rows[index]["close"])
    return (close / high - 1.0) * 100.0 if high > 0 else None


def record(candidate, trade, rows, index_by_ts, features, folds):
    index = index_by_ts[trade.signal_ts]
    close = float(rows[index]["close"])
    sma12 = features["sma12"][index]
    sma24 = features["sma24"][index]
    sma72 = features["sma72"][index]
    prior_sma24 = features["sma24"][index - 6] if index >= 6 else None
    btc_close = features["btcClose"][index] if index < len(features["btcClose"]) else None
    btc_sma = features["btcSma168"][index] if index < len(features["btcSma168"]) else None
    distance = v52.distance_atr(rows, index, candidate.lookback, candidate.side, features)
    return {
        "candidateId": candidate.candidate_id,
        "family": candidate.family,
        "side": candidate.side,
        "fold": fold_index(trade.entry_ts, folds),
        "signalTs": trade.signal_ts,
        "signalIso": dt.datetime.fromtimestamp(trade.signal_ts / 1000, tz=dt.timezone.utc).isoformat(),
        "entryTs": trade.entry_ts,
        "entryIso": dt.datetime.fromtimestamp(trade.entry_ts / 1000, tz=dt.timezone.utc).isoformat(),
        "basePct": trade.base_pct,
        "severePct": trade.severe_pct,
        "winner": trade.base_pct > 0,
        "confirmed": trade.confirmed,
        "mode": getattr(trade, "mode", None),
        "exitReason": trade.exit_reason,
        "mom1": features["mom1"][index],
        "mom3": features["mom3"][index],
        "relative3": features["relative3"][index],
        "volumeAcceleration": features["volumeAcceleration"][index],
        "volatilityExpansion": features["volatilityExpansion"][index],
        "bodyStrength": features["bodyStrength"][index],
        "directionCount": features["directionCount"][index],
        "distanceAtr": distance,
        "closeVsSma12Pct": (close / sma12 - 1.0) * 100.0 if sma12 else None,
        "closeVsSma24Pct": (close / sma24 - 1.0) * 100.0 if sma24 else None,
        "closeVsSma72Pct": (close / sma72 - 1.0) * 100.0 if sma72 else None,
        "sma24Slope6Pct": (sma24 / prior_sma24 - 1.0) * 100.0 if sma24 and prior_sma24 else None,
        "btcMom24": features["btcMom24"][index] if index < len(features["btcMom24"]) else None,
        "btcAboveSma168": bool(btc_close is not None and btc_sma is not None and btc_close > btc_sma),
        "drawdownFrom24hHighPct": prior_high_drawdown(rows, index, 24),
        "drawdownFrom72hHighPct": prior_high_drawdown(rows, index, 72),
    }


def aggregate(rows: List[dict], family: str, folds: List[int]) -> dict:
    selected = [row for row in rows if row["family"] == family and row["fold"] in folds]
    fields = [
        "basePct", "mom1", "mom3", "relative3", "volumeAcceleration", "volatilityExpansion",
        "bodyStrength", "distanceAtr", "closeVsSma12Pct", "closeVsSma24Pct", "closeVsSma72Pct",
        "sma24Slope6Pct", "btcMom24", "drawdownFrom24hHighPct", "drawdownFrom72hHighPct",
    ]
    result = {"trades": len(selected), "wins": sum(row["winner"] for row in selected), "returnSumPct": sum(row["basePct"] for row in selected)}
    for field in fields:
        values = [float(row[field]) for row in selected if row[field] is not None]
        result[field] = statistics.fmean(values) if values else None
    result["btcAboveSmaRatePct"] = sum(row["btcAboveSma168"] for row in selected) / len(selected) * 100.0 if selected else None
    return result


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    now_end = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000) // HOUR * HOUR
    pengu = v47.fetch_klines("PENGUUSDT", now_end)
    btc = v47.fetch_klines("BTCUSDT", now_end)
    funding = v47.fetch_funding("PENGUUSDT", now_end)
    features = v52.prepare_features(pengu, btc)
    folds = v50.fold_bounds(pengu, 5)
    index_by_ts = {int(row["ts"]): index for index, row in enumerate(pengu)}
    records = []
    for candidate in (REVERSAL, COMPRESSION, FLASH, DISTRIBUTION):
        trades, _ = v52.run_candidate(candidate, pengu, btc, funding, features)
        records.extend(record(candidate, trade, pengu, index_by_ts, features, folds) for trade in trades)
    summaries = {}
    for family in ("REVERSAL", "COMPRESSION", "FLASH", "DISTRIBUTION"):
        summaries[family] = {
            "train": aggregate(records, family, [0, 1, 2]),
            "validation": aggregate(records, family, [3]),
            "holdout": aggregate(records, family, [4]),
            "trainWinners": aggregate([row for row in records if row["winner"]], family, [0, 1, 2]),
            "trainLosers": aggregate([row for row in records if not row["winner"]], family, [0, 1, 2]),
            "holdoutWinners": aggregate([row for row in records if row["winner"]], family, [4]),
            "holdoutLosers": aggregate([row for row in records if not row["winner"]], family, [4]),
        }
    result = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "folds": [{"start": start, "end": end} for start, end in folds],
        "candidates": [asdict(c) for c in (REVERSAL, COMPRESSION, FLASH, DISTRIBUTION)],
        "summaries": summaries,
        "records": records,
        "safety": {"productionChanged": False, "liveChanged": False, "vpsChanged": False, "ordersSent": False},
    }
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-v53-trade-regime-audit.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    fields = list(records[0].keys()) if records else []
    with (state_dir / "pengu-v53-trade-regime-audit.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(records)
    report = ["# PENGU V53 Trade Regime Audit", ""]
    for family, item in summaries.items():
        report.append(f"## {family}")
        report.append("")
        for split in ("train", "validation", "holdout"):
            row = item[split]
            report.append(f"- {split}: N={row['trades']} / wins={row['wins']} / sum={row['returnSumPct']:.4f}% / BTC above SMA={row['btcAboveSmaRatePct']}")
        report.append("")
    report.append("- Production / LIVE / VPS changed: **NO**")
    (state_dir / "pengu-v53-trade-regime-audit.md").write_text("\n".join(report), encoding="utf-8")
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
