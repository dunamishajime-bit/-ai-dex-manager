from __future__ import annotations

import csv
import datetime as dt
import json
import os
import statistics
from dataclasses import asdict
from pathlib import Path
from typing import Dict, List, Optional

import research_lab_pengu_v57_extended_bt as common
import research_lab_pengu_v57_extended_bt_v3 as archive_source
import research_lab_pengu_wave_sleeve_v47 as v47
import research_lab_pengu_wave_sleeve_v49 as v49
import research_lab_pengu_wave_sleeve_v50 as v50
import research_lab_pengu_wave_sleeve_v52 as v52
import research_lab_pengu_wave_sleeve_v56 as v56

HOUR = v47.HOUR

v49.EXIT_PROFILES = tuple(v49.EXIT_PROFILES) + tuple(
    profile
    for profile in (
        v49.ExitProfile("RUN48", 2.2, 4.0, 4.0, 48),
        v49.ExitProfile("RUN72", 2.8, 5.0, 5.0, 72),
    )
    if profile.name not in {item.name for item in v49.EXIT_PROFILES}
)

FLASH = v52.Candidate(-1, "FLASH", 6, 2.0, 5.0, 0.0, 0.8, 1.0, 1.0, 0.4, 2, "RUN48")
DISTRIBUTION = v52.Candidate(-1, "DISTRIBUTION", 6, 1.4, 1.0, 1.5, 0.5, 0.6, 0.5, 0.2, 1, "WIDE")
V57_LONG = v50.Candidate(1, "BREAK", 6, 0.35, 2.0, 0.5, 1.1, 1.0, 2.2, 0.4, "WIDE")
WASHOUT = v56.WashoutScout(1, "WASHOUT", 6, 1.0, 1.5, 0.0, 0.3, 0.4, 9.0, 0.2, 1, "FAST", -3.0, -8.0, 0.30)


def rolling_mean(values: List[float], length: int) -> List[Optional[float]]:
    return v47.rolling_mean(values, length)


def rolling_std(values: List[float], length: int) -> List[Optional[float]]:
    result: List[Optional[float]] = [None] * len(values)
    for index in range(length - 1, len(values)):
        window = values[index - length + 1:index + 1]
        result[index] = statistics.pstdev(window)
    return result


def prepare_extra(rows: List[dict], features: dict) -> dict:
    close = [float(row["close"]) for row in rows]
    returns = [0.0]
    for index in range(1, len(close)):
        returns.append((close[index] / close[index - 1] - 1.0) * 100.0)
    tr = v47.true_range(rows)
    atr24 = features["atr24"]
    atr72 = rolling_mean(tr, 72)
    return {
        "returns": returns,
        "rv24": rolling_std(returns, 24),
        "rv72": rolling_std(returns, 72),
        "rv168": rolling_std(returns, 168),
        "absReturn24": rolling_mean([abs(value) for value in returns], 24),
        "atr72": atr72,
        "atr24Pct": [value / close[index] * 100.0 if value is not None and close[index] > 0 else None for index, value in enumerate(atr24)],
        "atr72Pct": [value / close[index] * 100.0 if value is not None and close[index] > 0 else None for index, value in enumerate(atr72)],
    }


def extrema_context(rows: List[dict], index: int, length: int) -> tuple[Optional[float], Optional[float]]:
    if index < length:
        return None, None
    close = float(rows[index]["close"])
    high = max(float(row["high"]) for row in rows[index - length:index])
    low = min(float(row["low"]) for row in rows[index - length:index])
    return (
        (close / high - 1.0) * 100.0 if high > 0 else None,
        (close / low - 1.0) * 100.0 if low > 0 else None,
    )


def signal_record(
    engine: str,
    trade: v50.Trade,
    rows: List[dict],
    features: dict,
    extra: dict,
    index_by_ts: Dict[int, int],
    folds: List[tuple[int, int]],
) -> dict:
    index = index_by_ts[int(trade.signal_ts)]
    dd24, up24 = extrema_context(rows, index, 24)
    dd72, up72 = extrema_context(rows, index, 72)
    fold = next((i for i, (start, end) in enumerate(folds) if start <= trade.entry_ts < end), -1)
    btc_close = features["btcClose"][index] if index < len(features["btcClose"]) else None
    btc_sma = features["btcSma168"][index] if index < len(features["btcSma168"]) else None
    return {
        "engine": engine,
        "candidateId": trade.candidate_id,
        "fold": fold,
        "signalTs": trade.signal_ts,
        "signalIso": dt.datetime.fromtimestamp(trade.signal_ts / 1000, tz=dt.timezone.utc).isoformat(),
        "entryTs": trade.entry_ts,
        "mode": trade.mode,
        "confirmed": trade.confirmed,
        "exitReason": trade.exit_reason,
        "basePct": trade.base_pct,
        "severePct": trade.severe_pct,
        "winner": trade.base_pct > 0,
        "mom1": features["mom1"][index],
        "mom3": features["mom3"][index],
        "relative3": features["relative3"][index],
        "volumeAcceleration": features["volumeAcceleration"][index],
        "volatilityExpansion": features["volatilityExpansion"][index],
        "bodyStrength": features["bodyStrength"][index],
        "directionCount": features["directionCount"][index],
        "atr24Pct": extra["atr24Pct"][index],
        "atr72Pct": extra["atr72Pct"][index],
        "rv24": extra["rv24"][index],
        "rv72": extra["rv72"][index],
        "rv168": extra["rv168"][index],
        "absReturn24": extra["absReturn24"][index],
        "drawdown24Pct": dd24,
        "runup24Pct": up24,
        "drawdown72Pct": dd72,
        "runup72Pct": up72,
        "btcMom24": features["btcMom24"][index],
        "btcAboveSma168": bool(btc_close is not None and btc_sma is not None and btc_close > btc_sma),
    }


def aggregate(records: List[dict], engine: str, folds: List[int]) -> dict:
    selected = [record for record in records if record["engine"] == engine and record["fold"] in folds]
    numeric = (
        "basePct", "severePct", "mom1", "mom3", "relative3", "volumeAcceleration",
        "volatilityExpansion", "bodyStrength", "atr24Pct", "atr72Pct", "rv24",
        "rv72", "rv168", "absReturn24", "drawdown24Pct", "runup24Pct",
        "drawdown72Pct", "runup72Pct", "btcMom24",
    )
    result = {
        "trades": len(selected),
        "wins": sum(record["winner"] for record in selected),
        "returnSumPct": sum(record["basePct"] for record in selected),
        "btcAboveSmaRatePct": sum(record["btcAboveSma168"] for record in selected) / len(selected) * 100.0 if selected else None,
    }
    for field in numeric:
        values = [float(record[field]) for record in selected if record[field] is not None]
        result[field] = statistics.fmean(values) if values else None
    return result


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    now = dt.datetime.now(dt.timezone.utc)
    last_complete = archive_source.previous_complete_month(now)
    months = list(archive_source.iter_months(archive_source.ARCHIVE_START, last_complete))
    pengu, pengu_months = archive_source.fetch_archive_klines("PENGUUSDT", months)
    relevant = archive_source.month_pairs(pengu_months)
    btc, _ = archive_source.fetch_archive_klines("BTCUSDT", relevant)
    funding, funding_months = archive_source.fetch_archive_funding("PENGUUSDT", relevant)
    pengu, btc, funding, _ = archive_source.trim_to_complete_funding_window(pengu, btc, funding, funding_months)
    pengu, btc = common.intersect_rows(pengu, btc)
    features = v52.prepare_features(pengu, btc)
    extra = prepare_extra(pengu, features)
    folds = v50.fold_bounds(pengu, 5)
    index_by_ts = {int(row["ts"]): index for index, row in enumerate(pengu)}

    flash, _ = v52.run_candidate(FLASH, pengu, btc, funding, features)
    distribution, _ = v52.run_candidate(DISTRIBUTION, pengu, btc, funding, features)
    base_long, _ = v50.run_candidate(V57_LONG, pengu, btc, funding, features)
    washout, _ = v56.run_candidate(WASHOUT, pengu, btc, funding, features)

    records: List[dict] = []
    for engine, trades in (
        ("FLASH", flash),
        ("DISTRIBUTION", distribution),
        ("LONG_BREAK", base_long),
        ("WASHOUT", washout),
    ):
        records.extend(
            signal_record(engine, trade, pengu, features, extra, index_by_ts, folds)
            for trade in trades
        )

    summaries = {}
    for engine in ("FLASH", "DISTRIBUTION", "LONG_BREAK", "WASHOUT"):
        summaries[engine] = {
            "train": aggregate(records, engine, [0, 1, 2]),
            "validation": aggregate(records, engine, [3]),
            "holdout": aggregate(records, engine, [4]),
            "selectionWinners": aggregate([r for r in records if r["winner"]], engine, [0, 1, 2, 3]),
            "selectionLosers": aggregate([r for r in records if not r["winner"]], engine, [0, 1, 2, 3]),
            "holdoutWinners": aggregate([r for r in records if r["winner"]], engine, [4]),
            "holdoutLosers": aggregate([r for r in records if not r["winner"]], engine, [4]),
        }

    result = {
        "generatedAt": now.isoformat(),
        "folds": [{"start": start, "end": end} for start, end in folds],
        "candidates": {
            "flash": asdict(FLASH),
            "distribution": asdict(DISTRIBUTION),
            "longBreak": asdict(V57_LONG),
            "washout": asdict(WASHOUT),
        },
        "summaries": summaries,
        "records": records,
        "safety": {"productionChanged": False, "liveChanged": False, "vpsChanged": False, "ordersSent": False},
    }
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-v58-signal-regime-audit.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    fields = list(records[0].keys()) if records else []
    with (state_dir / "pengu-v58-signal-regime-audit.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(records)
    report = ["# PENGU V58 Signal Regime Audit", ""]
    for engine, splits in summaries.items():
        report.append(f"## {engine}")
        report.append("")
        for split in ("train", "validation", "holdout"):
            row = splits[split]
            report.append(f"- {split}: N={row['trades']} / wins={row['wins']} / sum={row['returnSumPct']:.4f}% / RV24={row['rv24']} / ATR24%={row['atr24Pct']}")
        report.append("")
    report.append("- Production / LIVE / VPS changed: **NO**")
    (state_dir / "pengu-v58-signal-regime-audit.md").write_text("\n".join(report), encoding="utf-8")
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
