from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import hashlib
import json
import subprocess
import sys
import urllib.parse
from pathlib import Path
from typing import Any

UTC = dt.timezone.utc


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect frozen V13G/V13D Forward evidence.")
    parser.add_argument("--source-root")
    parser.add_argument("--source-commit")
    parser.add_argument("--config")
    parser.add_argument("--duration-seconds", type=int)
    parser.add_argument("--output-dir")
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Expected object: {path}")
    return payload


def seconds_of_day(local: dt.datetime) -> int:
    return local.hour * 3600 + local.minute * 60 + local.second


def clock_seconds(value: str) -> int:
    parts = [int(item) for item in value.split(":")]
    if len(parts) == 2:
        parts.append(0)
    return parts[0] * 3600 + parts[1] * 60 + parts[2]


def choose_same_batch(candidates: list[dict[str, Any]], blocked: str | None = None) -> dict[str, Any] | None:
    eligible = [
        row for row in candidates
        if row.get("eligibleForFrozenArms") is True and row.get("symbol") != blocked
    ]
    if not eligible:
        return None
    return sorted(eligible, key=lambda row: (-abs(float(row["basisDislocationBps"])), str(row["symbol"])))[0]


def load_frozen_modules(source_root: Path, expected_commit: str):
    research_dir = source_root / "research"
    if not research_dir.is_dir() or not (source_root / ".git").exists():
        raise RuntimeError("Frozen source checkout is incomplete")
    sys.path.insert(0, str(research_dir))
    import v96_stock_cross_venue_orderflow_v13_engine_base as engine_base
    import v96_stock_cross_venue_orderflow_v13_engine as engine_mod
    import v96_stock_cross_venue_orderflow_v13 as collector

    actual = subprocess.check_output(
        ["git", "-C", str(source_root), "rev-parse", "HEAD"], text=True
    ).strip()
    if actual != expected_commit:
        raise RuntimeError(f"Frozen source mismatch: expected {expected_commit}, got {actual}")
    return engine_base, engine_mod, collector


def configured_engine_class(engine_base, engine_mod, config: dict[str, Any]):
    rules = config["frozenRules"]
    decision_start = clock_seconds(rules["decisionClockNy"])
    decision_deadline = clock_seconds(rules["decisionDeadlineNy"])
    quote_expiry = clock_seconds(rules["entryQuoteExpiryNy"])
    late_decision = clock_seconds(rules["lateDecisionClockNy"])
    target_exit = clock_seconds(rules["targetExitClockNy"])

    class FixedDualEvidenceEngine(engine_mod.Engine):
        dual_config = config

        def __init__(self, writer):
            super().__init__(writer)
            self.dual_candidates: list[dict[str, Any]] = []
            self.dual_decision_done = False
            self.dual_decision_ms: int | None = None
            self.dual_late_checked: set[str] = set()

        def refresh(self, symbol: str, received_ms: int) -> None:
            if symbol in self.pending_hedges:
                return
            quote = self.quotes.get(symbol)
            if quote and quote["status"] == "OPEN":
                self.cancel_if_needed(quote, received_ms)

        def _local(self, received_ms: int) -> dt.datetime:
            return dt.datetime.fromtimestamp(received_ms / 1000, tz=UTC).astimezone(engine_base.NY)

        def _fixed_ms(self, local: dt.datetime, target_seconds: int) -> int:
            target = local.replace(
                hour=target_seconds // 3600,
                minute=(target_seconds % 3600) // 60,
                second=target_seconds % 60,
                microsecond=0,
            )
            return int(target.astimezone(UTC).timestamp() * 1000)

        def _candidate(self, symbol: str, received_ms: int) -> dict[str, Any]:
            pair = self.ready(symbol, received_ms)
            base_row: dict[str, Any] = {
                "recordType": "dual_entry_candidate",
                "decisionReceivedMs": received_ms,
                "symbol": symbol,
                "makerVenue": "ASTER",
                "hedgeVenue": "XYZ",
                "eligibleForFrozenArms": False,
            }
            if not pair:
                return {**base_row, "ineligibleReason": "MISSING_OR_STALE_BOOK"}
            aster, xyz = pair
            basis = (aster["mid"] / xyz["mid"] - 1.0) * 10_000.0
            side = "SELL" if basis > 0 else "BUY"
            maker_price, maker_usd = self.maker_top(aster, side)
            hedge_action = "BUY" if side == "SELL" else "SELL"
            hedge_price, hedge_usd = self.taker_top(xyz, hedge_action)
            quantity = engine_base.NOTIONAL / maker_price
            required_hedge = quantity * hedge_price
            gross = (
                (maker_price / hedge_price - 1.0) * 10_000.0
                if side == "SELL"
                else (hedge_price / maker_price - 1.0) * 10_000.0
            )
            projected = gross - engine_base.COSTS["NORMAL"]
            imbalance, adverse = self.flow_fields("ASTER", symbol, side, received_ms)
            reasons = []
            if abs(basis) < float(rules["minimumAbsoluteBasisDislocationBps"]):
                reasons.append("EDGE_FLOOR")
            if projected < float(rules["minimumProjectedNormalNetBps"]):
                reasons.append("PROJECTED_NORMAL")
            if maker_usd > float(rules["maximumDisplayedQueueUsd"]):
                reasons.append("QUEUE_TOO_LARGE")
            if hedge_usd < max(float(rules["minimumHedgeTopUsd"]), required_hedge):
                reasons.append("HEDGE_DEPTH")
            if adverse is not None and adverse > float(rules["maximumAdverseTradeImbalance"]):
                reasons.append("ADVERSE_FLOW")
            return {
                **base_row,
                "basisDislocationBps": basis,
                "side": side,
                "makerPrice": maker_price,
                "makerTopUsd": maker_usd,
                "hedgeAction": hedge_action,
                "hedgePrice": hedge_price,
                "hedgeTopUsd": hedge_usd,
                "requiredHedgeUsd": required_hedge,
                "grossExecutableEdgeBps": gross,
                "projectedNormalNetBps": projected,
                "tradeImbalance": imbalance,
                "adverseImbalance": adverse,
                "eligibleForFrozenArms": not reasons,
                "ineligibleReason": ",".join(reasons) if reasons else None,
            }

        def _open_batch(self, received_ms: int) -> None:
            if self.dual_decision_done:
                return
            local = self._local(received_ms)
            expiry_ms = self._fixed_ms(local, quote_expiry)
            self.dual_decision_done = True
            self.dual_decision_ms = received_ms
            for symbol in engine_base.SYMBOLS:
                candidate = self._candidate(symbol, received_ms)
                self.dual_candidates.append(candidate)
                self.record(candidate)
                if not candidate["eligibleForFrozenArms"]:
                    continue
                self.counter += 1
                quantity = engine_base.NOTIONAL / candidate["makerPrice"]
                hedge = self.books[("XYZ", symbol)]
                quote = {
                    "purpose": "OPEN",
                    "symbol": symbol,
                    "makerVenue": "ASTER",
                    "hedgeVenue": "XYZ",
                    "side": candidate["side"],
                    "makerPrice": candidate["makerPrice"],
                    "makerTopUsd": candidate["makerTopUsd"],
                    "hedgePrice": candidate["hedgePrice"],
                    "hedgeTopUsd": candidate["hedgeTopUsd"],
                    "requiredHedgeUsd": candidate["requiredHedgeUsd"],
                    "grossEdgeBps": candidate["grossExecutableEdgeBps"],
                    "projectedNormalNetBps": candidate["projectedNormalNetBps"],
                    "tradeImbalance": candidate["tradeImbalance"],
                    "adverseImbalance": candidate["adverseImbalance"],
                    "eligible": True,
                    "basisDislocationBps": candidate["basisDislocationBps"],
                    "decisionReceivedMs": received_ms,
                    "quoteId": f"v13dual-{self.counter:08d}",
                    "quantity": quantity,
                    "targetFillUsd": quantity * candidate["makerPrice"],
                    "createdMs": received_ms,
                    "expiresMs": expiry_ms,
                    "queueAheadUsd": candidate["makerTopUsd"],
                    "filledUsd": 0.0,
                    "referenceMid": hedge["mid"],
                    "status": "OPEN",
                    "cancelReason": None,
                }
                self.quotes[symbol] = quote
                self.stats["quotes"] += 1
                self.record({"recordType": "virtual_quote_open", **quote})
            self.record({
                "recordType": "dual_decision_batch",
                "decisionReceivedMs": received_ms,
                "symbols": list(engine_base.SYMBOLS),
                "candidateCount": len(self.dual_candidates),
                "eligibleSymbols": [row["symbol"] for row in self.dual_candidates if row["eligibleForFrozenArms"]],
            })

        def _mark_to_taker_bps(self, symbol: str, received_ms: int) -> float | None:
            inv = self.inventory.get(symbol)
            pair = self.ready(symbol, received_ms)
            if not inv or not pair:
                return None
            maker = self.books[("ASTER", symbol)]
            hedge = self.books[("XYZ", symbol)]
            maker_action = "SELL" if inv["openSide"] == "BUY" else "BUY"
            hedge_action = "BUY" if inv["openSide"] == "BUY" else "SELL"
            maker_price, maker_usd = self.taker_top(maker, maker_action)
            hedge_price, hedge_usd = self.taker_top(hedge, hedge_action)
            if maker_usd < inv["quantity"] * maker_price or hedge_usd < inv["quantity"] * hedge_price:
                return None
            return self.cycle_gross_bps(inv, maker_price, hedge_price)

        def tick(self, received_ms: int) -> None:
            self.process_pending_hedges(received_ms)
            local = self._local(received_ms)
            sec = seconds_of_day(local)
            if local.weekday() < 5 and not self.dual_decision_done and decision_start <= sec <= decision_deadline:
                all_ready = all(self.ready(symbol, received_ms) for symbol in engine_base.SYMBOLS)
                if all_ready or sec >= decision_deadline:
                    self._open_batch(received_ms)
            for quote in self.quotes.values():
                if quote["status"] == "OPEN":
                    self.cancel_if_needed(quote, received_ms)
            if sec >= late_decision:
                for symbol, inv in list(self.inventory.items()):
                    inventory_id = inv["inventoryId"]
                    if inventory_id not in self.dual_late_checked:
                        marked = self._mark_to_taker_bps(symbol, received_ms)
                        self.record({
                            "recordType": "dual_late_exit_decision",
                            "receivedMs": received_ms,
                            "symbol": symbol,
                            "inventoryId": inventory_id,
                            "priceGrossBps": marked,
                            "thresholdBps": float(rules["lateTakeProfitPriceBps"]),
                            "triggered": marked is not None and marked >= float(rules["lateTakeProfitPriceBps"]),
                        })
                        self.dual_late_checked.add(inventory_id)
                        if marked is not None and marked >= float(rules["lateTakeProfitPriceBps"]):
                            self.force_close(symbol, received_ms, "LATE_TP30")
            if sec >= target_exit:
                for symbol in list(self.inventory):
                    self.force_close(symbol, received_ms, "TARGET_1500")

        def result(self) -> dict:
            result = super().result()
            result["fixedDualEvidence"] = {
                "decisionDone": self.dual_decision_done,
                "decisionReceivedMs": self.dual_decision_ms,
                "candidateCount": len(self.dual_candidates),
                "eligibleSymbols": [row["symbol"] for row in self.dual_candidates if row["eligibleForFrozenArms"]],
                "frozenArms": ["V13G", "V13D"],
                "retuningAllowed": False,
            }
            return result

    return FixedDualEvidenceEngine


def fetch_funding(collector, config: dict[str, Any], started_ms: int, ended_ms: int) -> dict[str, Any]:
    output: dict[str, Any] = {"startedMs": started_ms, "endedMs": ended_ms, "rows": {}, "errors": []}
    for symbol in config["universe"]:
        output["rows"][symbol] = {"ASTER": [], "XYZ": []}
        try:
            query = urllib.parse.urlencode({
                "symbol": f"{symbol}USDT", "startTime": started_ms, "endTime": ended_ms, "limit": 1000
            })
            rows = collector.request_json(f"https://fapi.asterdex.com/fapi/v1/fundingRate?{query}")
            output["rows"][symbol]["ASTER"] = rows if isinstance(rows, list) else []
        except Exception as exc:
            output["errors"].append({"symbol": symbol, "venue": "ASTER", "error": repr(exc)})
        try:
            rows = collector.request_json("https://api.hyperliquid.xyz/info", {
                "type": "fundingHistory", "coin": f"xyz:{symbol}", "startTime": started_ms, "endTime": ended_ms
            })
            output["rows"][symbol]["XYZ"] = rows if isinstance(rows, list) else []
        except Exception as exc:
            output["errors"].append({"symbol": symbol, "venue": "XYZ", "error": repr(exc)})
    return output


def self_test() -> None:
    candidates = [
        {"symbol": "META", "basisDislocationBps": 25.0, "eligibleForFrozenArms": True},
        {"symbol": "AMZN", "basisDislocationBps": -30.0, "eligibleForFrozenArms": True},
        {"symbol": "NVDA", "basisDislocationBps": 40.0, "eligibleForFrozenArms": False},
    ]
    assert choose_same_batch(candidates)["symbol"] == "AMZN"
    assert choose_same_batch(candidates, blocked="AMZN")["symbol"] == "META"
    assert clock_seconds("09:59:55") == 35_995
    assert clock_seconds("15:00:00") == 54_000
    print("V13G/V13D wrapper self-test: PASS")


def main() -> int:
    args = parse_args()
    self_test()
    if args.self_test:
        return 0
    if not all((args.source_root, args.source_commit, args.config, args.duration_seconds, args.output_dir)):
        raise ValueError("source-root, source-commit, config, duration-seconds and output-dir are required")
    source_root = Path(args.source_root).resolve()
    config_path = Path(args.config).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    config = load_json(config_path)
    engine_base, engine_mod, collector = load_frozen_modules(source_root, args.source_commit)
    collector.Engine = configured_engine_class(engine_base, engine_mod, config)
    started_ms = int(dt.datetime.now(UTC).timestamp() * 1000)
    result = asyncio.run(collector.probe(int(args.duration_seconds), output_dir))
    ended_ms = int(dt.datetime.now(UTC).timestamp() * 1000)
    funding = fetch_funding(collector, config, started_ms, ended_ms)
    (output_dir / "funding.json").write_text(json.dumps(funding, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    metadata = {
        "strategyId": config["strategyId"],
        "sourceCommit": args.source_commit,
        "configSha256": hashlib.sha256(config_path.read_bytes()).hexdigest(),
        "startedMs": started_ms,
        "endedMs": ended_ms,
        "durationSeconds": int(args.duration_seconds),
        "resultStatus": result.get("status"),
        "fixedDualEvidence": result.get("fixedDualEvidence"),
        "fundingErrors": funding["errors"],
        "safety": config["safety"],
    }
    (output_dir / "dual-wrapper-metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({"strategyId": config["strategyId"], "status": result.get("status")}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
