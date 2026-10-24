#!/usr/bin/env python3
"""Research-only as-of portfolio collision audit for RENDER #4427 independent SHORT.
Reads six frozen Native8 decision/trade ledgers; does not change any gate or order.
"""
import datetime as dt
import hashlib
import json
from pathlib import Path

ROOT = Path("C:/tmp/render-mtf-study-20261024")
RUNS = ROOT / "native8-indep-sell55-20261024"
DEST = ROOT / "RENDER_4427_INDEPENDENT_GATE_NATIVE8_POSITION_COLLISION_AUDIT_20261024.json"
ROUTE = "IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT"

def utc(ms):
    return dt.datetime.fromtimestamp(int(ms) / 1000, dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")

def rows(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]

def snapshot(path):
    decisions = rows(path)
    trades = rows(path.parent / "portfolio-trades.jsonl")
    candidates = sorted((r for r in decisions if r.get("route") == ROUTE),
                        key=lambda r: int(r["entry_ts_ms"]))
    assert len(candidates) == 3, ("EXPECTED_THREE_CANDIDATES", str(path), len(candidates))
    results = []
    for candidate in candidates:
        t = int(candidate["entry_ts_ms"])
        assert candidate["decision"] == "REJECTED_PORTFOLIO"
        assert candidate["reason"] == "IDLE:CORE_SIGNAL_OR_POSITION"
        active = [r for r in trades if int(r["entry_ts_ms"]) <= t < int(r["exit_ts_ms"])]
        render = [r for r in active if r["symbol"] == "RENDERUSDT"]
        idle = [r for r in active if r["strategy_id"] == "IDLE"]
        prev = [r for r in trades if r["symbol"] == "RENDERUSDT" and int(r["exit_ts_ms"]) <= t]
        latest = max(prev, key=lambda r: int(r["exit_ts_ms"])) if prev else None
        same_time = [r for r in decisions if int(r.get("entry_ts_ms") or -1) == t and r.get("route") != ROUTE]
        results.append({
            "entryUtc": utc(t),
            "rejection": candidate["reason"],
            "openRenderPositions": [{"route": r.get("route"), "side": r["side"],
                                     "entryUtc": utc(r["entry_ts_ms"]), "exitUtc": utc(r["exit_ts_ms"])}
                                    for r in sorted(render, key=lambda r: r["entry_ts_ms"])],
            "openIdlePositionCount": len(idle),
            "allOpenPositionCount": len(active),
            "activeAcceptedGrossSum": round(sum(float(r["accepted_gross"]) for r in active), 6),
            "priorRenderExitHours": round((t - int(latest["exit_ts_ms"])) / 3600000, 3) if latest else None,
            "sameTimeOtherCandidates": sorted([
                {"strategy": r["strategy_id"], "symbol": r["symbol"], "route": r.get("route"),
                 "decision": r["decision"], "reason": r["reason"]} for r in same_time
            ], key=lambda r: (r["strategy"], r["symbol"], str(r["route"]))),
            "sameSymbolPositionCollision": bool(render),
            "sameSymbolAnd12hCooldownClear": not render and (latest is None or t - int(latest["exit_ts_ms"]) >= 12 * 3600000),
        })
    return results

def main():
    out = {
        "status": "RESEARCH_ONLY_ASOF_NATIVE8_POSITION_COLLISION_AUDIT",
        "sourceBranch": "research/render4427-independent-gates-full8-blocker-20261024",
        "sourceSha": "173659aef0e28826c4f1c2a2db47a5957eaa5085",
        "method": "Inspect frozen accepted trade intervals and candidate decisions at the three independent SHORT timestamps; no candidate promoted.",
        "costs": {},
        "limitations": [
            "Open-position and elapsed-exit checks do not establish owner registration, global risk/margin/gross approval, or executable fills.",
            "2025 Aster RENDER H1 mark remains missing; modeled 2026 candidates only.",
            "Funding and actual Aster 5m execution not authenticated.",
            "All periods previously researched; not unused OOS.",
            "No LIVE/VPS/Production/HP/order changes."
        ],
    }
    for cost in (10, 30):
        files = sorted(p for p in RUNS.rglob("candidate-decisions.jsonl")
                       if p.parent.name == f"PRICE_MODEL_{cost}BPS")
        assert len(files) == 3, ("THREE_REPLAYS_REQUIRED", cost, len(files))
        views = [snapshot(f) for f in files]
        payloads = [json.dumps(v, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8") for v in views]
        digests = [hashlib.sha256(p).hexdigest() for p in payloads]
        assert len(set(digests)) == 1, ("REPLAY_POSITION_SNAPSHOT_MISMATCH", cost, digests)
        events = views[0]
        assert [r["entryUtc"] for r in events] == ["2026-05-27T21:00Z", "2026-06-23T01:00Z", "2026-06-25T07:00Z"]
        assert [r["sameSymbolPositionCollision"] for r in events] == [True, False, False]
        assert [r["sameSymbolAnd12hCooldownClear"] for r in events] == [False, True, True]
        out["costs"][str(cost)] = {"replayCount": 3, "threeReplaySnapshotSha256": digests[0],
                                   "sameSymbolPositionCollisionCount": 1,
                                   "sameSymbolAnd12hCooldownClearCount": 2, "events": events}
    text = json.dumps(out, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
    DEST.write_text(text, encoding="utf-8")
    print("AUDIT_PASS", DEST)
    print("JSON_SHA256", hashlib.sha256(text.encode("utf-8")).hexdigest())
    for cost, entry in out["costs"].items():
        print("COST", cost, "REPLAY_SHA", entry["threeReplaySnapshotSha256"])
        for e in entry["events"]:
            print("EVENT", e["entryUtc"], "renderCollision", e["sameSymbolPositionCollision"],
                  "clearSymbolAnd12h", e["sameSymbolAnd12hCooldownClear"],
                  "activeGross", e["activeAcceptedGrossSum"],
                  "otherCandidates", [(c["strategy"], c["decision"], c["reason"]) for c in e["sameTimeOtherCandidates"]])

if __name__ == "__main__":
    main()
