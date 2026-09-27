"""Generate point-in-time decision/gate traces from audited LIVE functions."""

from __future__ import annotations

import argparse
from datetime import date, datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from typing import Any

from .acquire import END_DATE, START_DATE, _time_ms, extract_universes
from .manifest import load_manifest
from .strategies import RuntimeBridge


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def _save_jsonl(path: Path, rows: list[dict[str, Any]]) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    body = "".join(json.dumps(row, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n" for row in rows).encode("utf-8")
    path.write_bytes(body)
    return {"path": str(path), "rows": len(rows), "sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body)}


def _history_path(data_root: Path, symbol: str) -> Path:
    return data_root / "normalized" / "aster" / "klines" / f"{symbol}.jsonl"


def _decision_row(strategy: str, symbol: str, ts: int, gate: str, status: str, reason: str, data: Any = None) -> dict[str, Any]:
    return {"strategy_id": strategy, "symbol": symbol, "decision_ts_ms": ts, "gate": gate, "status": status, "reason": reason, "details": data}


def scan(data_root: str | Path, output_root: str | Path, *, strategies: tuple[str, ...] = ("V12", "PENGU", "Q102", "FET"), start_date: date = START_DATE, end_date_exclusive: date = END_DATE) -> dict[str, Any]:
    root = Path(data_root).resolve()
    output = Path(output_root).resolve()
    source_manifest = load_manifest(Path(__file__).resolve().with_name("runtime_source_manifest.json"))
    acquired = json.loads((root / "acquisition-manifest.json").read_text(encoding="utf-8"))
    if acquired.get("runtime_sha") != source_manifest["runtime_sha"]:
        raise ValueError("ACQUISITION_RUNTIME_SHA_MISMATCH")
    universes = extract_universes()
    start_ms, end_ms = _time_ms(start_date), _time_ms(end_date_exclusive)
    paths: dict[str, Any] = {}
    stats: dict[str, Any] = {}

    with RuntimeBridge() as bridge:
        if "V12" in strategies:
            h1: dict[str, list[dict[str, Any]]] = {}
            raw_rows_by_symbol: dict[str, list[dict[str, Any]]] = {}
            for symbol in universes["V12"]:
                rows = _load_jsonl(_history_path(root, symbol))
                raw_rows_by_symbol[symbol] = rows
                h1[symbol] = [{
                    "ts": int(row["event_time_ms"]), "open": row["open"], "high": row["high"],
                    "low": row["low"], "close": row["close"], "volume": row["base_volume"], "closed": True,
                } for row in rows]
            series = bridge.v12_series(h1, start_ms, end_ms)
            decisions = []
            for record in series.get("results", []):
                observation = record.get("observation")
                ts = int(record["decisionTs"])
                if not observation:
                    continue
                candidates = {item["symbol"].upper() + "USDT": item for item in observation.get("candidates", [])}
                signals = {item["symbol"].upper() + "USDT": item for item in record.get("signals", [])}
                for symbol in universes["V12"]:
                    candidate = candidates.get(symbol)
                    signal = signals.get(symbol)
                    decisions.append({
                        "strategy_id": "V12", "symbol": symbol, "decision_ts_ms": ts,
                        "reference_ts_ms": observation.get("referenceTs"), "entry_ts_ms": observation.get("entryTs"),
                        "btc_regime": observation.get("btcRegime"),
                        "status": "SIGNAL" if signal else "CANDIDATE_REJECTED" if candidate else "NO_CANDIDATE_METRICS",
                        "signal": signal,
                        "candidate": candidate,
                        "gate_status": {
                            "BTC_REGIME": "PASS" if observation.get("btcRegime") else "UNVERIFIED",
                            "CANDIDATE_METRICS": "PASS" if candidate else "UNVERIFIED",
                            "CANDIDATE_ELIGIBILITY": ("PASS" if candidate.get("signalEligible") else "FAIL") if candidate else "UNVERIFIED",
                            "ENTRY_HC175": ("PASS" if candidate.get("entryGateReason") in {"ALLOW_STANDARD", "ALLOW_HC175"} else "FAIL") if candidate and candidate.get("entryGateReason") else "NOT_REACHED",
                            "PORTFOLIO_RANK": "PASS" if candidate and candidate.get("portfolioRank") else "FAIL" if candidate else "NOT_REACHED",
                        },
                        "data_cutoff_ms": min(ts, int(observation.get("referenceTs") or ts)),
                        "source_runtime_sha": bridge.runtime_sha,
                    })
            paths["V12"] = _save_jsonl(output / "decisions" / "V12.jsonl", decisions)
            stats["V12"] = {"timestamps": len(series.get("results", [])), "decision_rows": len(decisions), "signal_rows": sum(row["status"] == "SIGNAL" for row in decisions), "h2_counts": series.get("h2Counts")}

        if "PENGU" in strategies:
            pengu_rows = _load_jsonl(_history_path(root, "PENGUUSDT"))
            btc_rows = _load_jsonl(_history_path(root, "BTCUSDT"))
            first_open, last_open = int(pengu_rows[0]["event_time_ms"]), int(pengu_rows[-1]["event_time_ms"])
            btc_by_ts = {int(row["event_time_ms"]): row for row in btc_rows if first_open <= int(row["event_time_ms"]) <= last_open}
            pengu_history = [{"openTime": int(row["event_time_ms"]), "closeTime": int(row["close_time_ms"]), "open": row["open"], "high": row["high"], "low": row["low"], "close": row["close"], "volume": row["base_volume"]} for row in pengu_rows]
            btc_history = [{"openTime": int(row["event_time_ms"]), "closeTime": int(row["close_time_ms"]), "open": row["open"], "high": row["high"], "low": row["low"], "close": row["close"], "volume": row["base_volume"]} for row in (btc_by_ts[key] for key in sorted(btc_by_ts))]
            series = bridge.pengu_series({"pengu1h": pengu_history, "btc1h": btc_history, "penguFunding": []}, end_ms + 1)
            decisions = []
            for row in series:
                features = row.get("features")
                if not features:
                    continue
                candle = row["candle"]
                close_time = int(candle["closeTime"])
                if not (start_ms <= close_time < end_ms):
                    continue
                decision = row.get("decision") or {}
                decision_ts = close_time + 1
                decisions.append({
                    "strategy_id": "PENGU", "symbol": "PENGUUSDT", "decision_ts_ms": decision_ts,
                    "reference_ts_ms": features.get("referenceTs"),
                    "status": "SIGNAL" if decision.get("side") else "WAIT",
                    "side": decision.get("side", 0),
                    "long_raw": row.get("longRaw", False), "long_signal": row.get("longSignal", False),
                    "short_signal": row.get("shortSignal", False), "short_setup_active": row.get("shortSetupActive", False),
                    "short_setup_armed": row.get("shortSetupArmed", False),
                    "recovery_v8": row.get("recoveryV8"), "features": features,
                    "runtime_reason": decision.get("reason"),
                    "data_cutoff_ms": close_time,
                    "source_runtime_sha": bridge.runtime_sha,
                })
            paths["PENGU"] = _save_jsonl(output / "decisions" / "PENGU.jsonl", decisions)
            stats["PENGU"] = {"decision_rows": len(decisions), "signal_rows": sum(row["status"] == "SIGNAL" for row in decisions), "long_raw_rows": sum(row["long_raw"] for row in decisions), "short_rows": sum(row["short_signal"] for row in decisions)}

        if "FET" in strategies:
            fet_rows = _load_jsonl(_history_path(root, "FETUSDT"))
            raw = [[row["event_time_ms"], str(row["open"]), str(row["high"]), str(row["low"]), str(row["close"]), str(row["base_volume"]), row["close_time_ms"], str(row.get("quote_volume") or 0)] for row in fet_rows]
            series = bridge.fet_series(raw, start_ms, end_ms)
            decisions = []
            for row in series:
                ts = int(row["decisionTs"])
                signal = row.get("signal")
                completed = [bar for bar in fet_rows if int(bar["close_time_ms"]) < ts]
                decisions.append({
                    "strategy_id": "FET", "symbol": "FETUSDT", "decision_ts_ms": ts,
                    "status": "SIGNAL" if signal else "WAIT",
                    "signal": signal,
                    "gate_status": {"ENTRY_SCHEDULE": "PASS", "HISTORY_DEPTH": "PASS" if len(completed) >= 73 else "FAIL", "BREAKOUT_AND_VOLUME": "PASS" if signal else "FAIL"},
                    "data_cutoff_ms": max((int(item["close_time_ms"]) for item in completed), default=0),
                    "source_runtime_sha": bridge.runtime_sha,
                })
            paths["FET"] = _save_jsonl(output / "decisions" / "FET.jsonl", decisions)
            stats["FET"] = {"decision_rows": len(decisions), "signal_rows": sum(row["status"] == "SIGNAL" for row in decisions), "first_bar_ms": int(fet_rows[0]["event_time_ms"]) if fet_rows else None}

        if "Q102" in strategies:
            q102_symbols = universes["Q102"]
            high_vol_symbols = list(source_manifest["config_allowlist"]["live_process_environment"]["QUALITY102_CAUSAL_V1_SYMBOLS"])
            candles_by_symbol = {}
            for symbol in [*q102_symbols, "BTCUSDT"]:
                rows = _load_jsonl(_history_path(root, symbol))
                candles_by_symbol[symbol] = [{
                    "timestampMs": int(row["event_time_ms"]), "open": row["open"], "high": row["high"],
                    "low": row["low"], "close": row["close"], "quoteVolume": row.get("quote_volume") or 0,
                    "baseVolume": row["base_volume"],
                } for row in rows]
            series = bridge.q102_series(candles_by_symbol, high_vol_symbols, q102_symbols, start_ms, end_ms)
            decisions = []
            for event in series:
                snapshot = event.get("snapshot")
                ts = int(event["decisionTs"])
                if snapshot is None:
                    for symbol in q102_symbols:
                        decisions.append({"strategy_id": "Q102", "symbol": symbol, "decision_ts_ms": ts, "status": "NOT_VERIFIABLE", "reason": event.get("error", "Q102_SNAPSHOT_MISSING"), "data_cutoff_ms": ts, "source_runtime_sha": bridge.runtime_sha})
                    continue
                exact_signal = event.get("signal") or {}
                for item in snapshot.get("items", []):
                    selected = bool(item.get("selected"))
                    decisions.append({
                        "strategy_id": "Q102", "symbol": item["symbol"], "decision_ts_ms": ts,
                        "status": "SIGNAL" if selected else "CANDIDATE" if item.get("eligible") else "WAIT",
                        "item": item,
                        "signal": exact_signal if selected else None,
                        "selected_symbol": snapshot.get("selectedSymbol"),
                        "selected_reason": snapshot.get("selectedReason"),
                        "data_cutoff_ms": min(ts, int(item.get("referenceTs") or ts)),
                        "source_runtime_sha": bridge.runtime_sha,
                    })
            paths["Q102"] = _save_jsonl(output / "decisions" / "Q102.jsonl", decisions)
            stats["Q102"] = {"decision_timestamps": len(series), "decision_rows": len(decisions), "signal_rows": sum(row["status"] == "SIGNAL" for row in decisions), "error_timestamps": sum("error" in event for event in series)}

    manifest = {
        "schema_version": 1,
        "status": "SIGNAL_SCAN_ONLY_NOT_A_BACKTEST",
        "runtime_sha": source_manifest["runtime_sha"],
        "acquisition_manifest_sha256": hashlib.sha256((root / "acquisition-manifest.json").read_bytes()).hexdigest(),
        "period_start": start_date.isoformat(),
        "period_end_inclusive": end_date_exclusive.fromordinal(end_date_exclusive.toordinal() - 1).isoformat(),
        "strategies": list(strategies),
        "outputs": paths,
        "stats": stats,
    }
    raw = (json.dumps(manifest, sort_keys=True, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    (output / "signal-scan-manifest.json").parent.mkdir(parents=True, exist_ok=True)
    (output / "signal-scan-manifest.json").write_bytes(raw)
    manifest["sha256"] = hashlib.sha256(raw).hexdigest()
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", required=True)
    parser.add_argument("--output-root", required=True)
    parser.add_argument("--strategies", nargs="+", default=["V12", "PENGU", "Q102", "FET"])
    args = parser.parse_args(argv)
    summary = scan(args.data_root, args.output_root, strategies=tuple(x.upper() for x in args.strategies))
    print(json.dumps({"status": summary["status"], "runtime_sha": summary["runtime_sha"], "stats": summary["stats"], "manifest_sha256": summary["sha256"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
