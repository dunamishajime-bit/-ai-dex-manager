from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
from typing import List, Optional

import research_lab_pengu_wave_sleeve_v47 as v47
import research_lab_pengu_wave_sleeve_v50 as v50

HOUR = v47.HOUR
AUDIT_VERSION = 1


def prior_boundary(rows: List[dict], index: int, lookback: int, side: int) -> Optional[float]:
    if index < lookback:
        return None
    prior = rows[index - lookback:index]
    return max(float(row["high"]) for row in prior) if side > 0 else min(float(row["low"]) for row in prior)


def snapshot(rows: List[dict], features: dict, index: int, side: int) -> dict:
    close = float(rows[index]["close"])
    atr = features["atr24"][index]
    boundary6 = prior_boundary(rows, index, 6, side)
    boundary12 = prior_boundary(rows, index, 12, side)
    def distance(boundary):
        if boundary is None or atr is None or atr <= 0:
            return None
        return (boundary - close) / atr if side > 0 else (close - boundary) / atr
    return {
        "ts": int(rows[index]["ts"]),
        "iso": dt.datetime.fromtimestamp(int(rows[index]["ts"]) / 1000, tz=dt.timezone.utc).isoformat(),
        "open": float(rows[index]["open"]),
        "high": float(rows[index]["high"]),
        "low": float(rows[index]["low"]),
        "close": close,
        "mom1": features["mom1"][index],
        "mom3": features["mom3"][index],
        "relative3": features["relative3"][index],
        "volumeAcceleration": features["volumeAcceleration"][index],
        "volatilityExpansion": features["volatilityExpansion"][index],
        "bodyStrength": features["bodyStrength"][index],
        "directionCount": features["directionCount"][index],
        "atr24": atr,
        "distanceAtr6": distance(boundary6),
        "distanceAtr12": distance(boundary12),
        "btcMom24": features["btcMom24"][index] if index < len(features["btcMom24"]) else None,
        "btcClose": features["btcClose"][index] if index < len(features["btcClose"]) else None,
        "btcSma168": features["btcSma168"][index] if index < len(features["btcSma168"]) else None,
    }


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    now_end = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000) // HOUR * HOUR
    print("Fetching Aster PENGU/BTC history for wave feature audit")
    pengu = v47.fetch_klines("PENGUUSDT", now_end)
    btc = v47.fetch_klines("BTCUSDT", now_end)
    features = v50.prepare_features(pengu, btc)
    index_by_ts = {int(row["ts"]): index for index, row in enumerate(pengu)}
    major24 = v50.wave_events(pengu, 24, 20.0)
    major72 = v50.wave_events(pengu, 72, 35.0)
    events = []
    for horizon, raw in ((24, major24), (72, major72)):
        for event in raw:
            start_index = index_by_ts.get(int(event["startTs"]))
            if start_index is None:
                continue
            side = int(event["side"])
            window = []
            for offset in range(-12, 13):
                index = start_index + offset
                if 0 <= index < len(pengu):
                    item = snapshot(pengu, features, index, side)
                    item["offsetHours"] = offset
                    window.append(item)
            events.append({
                "horizonHours": horizon,
                "side": side,
                "startTs": event["startTs"],
                "endTs": event["endTs"],
                "maxMovePct": event["maxMovePct"],
                "peakWindowStartTs": event["peakWindowStartTs"],
                "window": window,
            })
    result = {
        "auditVersion": AUDIT_VERSION,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "events": events,
        "eventCounts": {"major24": len(major24), "major72": len(major72)},
        "safety": {"productionChanged": False, "liveChanged": False, "vpsChanged": False, "ordersSent": False},
    }
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-wave-feature-audit.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    report = ["# PENGU Wave Feature Audit", "", f"- Major 24h events: {len(major24)}", f"- Major 72h events: {len(major72)}", ""]
    for event in events:
        report.append(f"## {event['horizonHours']}h {event['maxMovePct']:.4f}% side={event['side']}")
        report.append("")
        report.append("| Offset | Mom1 | Mom3 | Rel3 | VolAccel | VolExpand | DistATR6 | Body | Dir |")
        report.append("|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
        for row in event["window"]:
            if row["offsetHours"] < -6 or row["offsetHours"] > 6:
                continue
            def f(value):
                return "NA" if value is None else f"{value:.3f}"
            report.append(
                f"| {row['offsetHours']} | {f(row['mom1'])} | {f(row['mom3'])} | {f(row['relative3'])} | {f(row['volumeAcceleration'])} | {f(row['volatilityExpansion'])} | {f(row['distanceAtr6'])} | {f(row['bodyStrength'])} | {row['directionCount']} |"
            )
        report.append("")
    report.append("- Production / LIVE / VPS changed: **NO**")
    (state_dir / "pengu-wave-feature-audit.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
