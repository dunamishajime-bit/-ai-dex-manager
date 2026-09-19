#!/usr/bin/env python3
import argparse
import json
import re
import sys
from pathlib import Path

CRITICAL = re.compile(r"fatal|panic|traceback|exception|kill.?switch|fail.?closed|operator.?review|corrupt|mismatch", re.I)
WARNING = re.compile(r"error|failed|timeout|429|503|restart|blocked|stale|unknown|warning|denied|enoent", re.I)
META = re.compile(r"sha|commit|branch|service|active|running|nrestarts|margin|gross|risk|health|position|order|test|pass", re.I)

def read_text(path):
    if not path or path == "-":
        return sys.stdin.read()
    return Path(path).read_text(encoding="utf-8", errors="replace")

def _line_score(line):
    if CRITICAL.search(line):
        return 100
    if WARNING.search(line):
        return 60
    if META.search(line):
        return 20
    return 0
def reduce_text(text, max_lines=80, context=1):
    lines = text.splitlines()
    scored = [(i, _line_score(line)) for i, line in enumerate(lines)]
    ranked = sorted((x for x in scored if x[1] > 0), key=lambda x: (-x[1], x[0]))
    chosen = set()
    for index, _score in ranked:
        for j in range(max(0, index-context), min(len(lines), index+context+1)):
            chosen.add(j)
        if len(chosen) >= max_lines:
            break
    if not chosen and lines:
        chosen.update(range(min(len(lines), max_lines)))
    ordered = sorted(chosen)[:max_lines]
    selected = [lines[i] for i in ordered]
    counts = {
        "critical": sum(1 for line in selected if CRITICAL.search(line)),
        "warning": sum(1 for line in selected if WARNING.search(line)),
        "metadata": sum(1 for line in selected if META.search(line)),
    }
    return {
        "original_lines": len(lines),
        "selected_lines": len(selected),
        "compression_ratio": round((len(selected) / max(1, len(lines))), 4),
        "signal_counts": counts,
        "compact_text": "\n".join(selected),
    }
def _status(value):
    if value is True:
        return "pass"
    if value is False:
        return "fail"
    if value is None:
        return "unknown"
    text = str(value).strip().lower()
    if text in {"pass", "passed", "ok", "healthy", "true", "yes"}:
        return "pass"
    if text in {"fail", "failed", "false", "no", "blocked", "unhealthy"}:
        return "fail"
    return "unknown"

def judge(payload):
    checks = payload.get("checks") or []
    uncertainties = list(payload.get("uncertainties") or [])
    conflicts = list(payload.get("conflicts") or [])
    deep = bool(payload.get("requires_deep_reasoning", False))
    normalized = []
    for raw in checks:
        item = dict(raw)
        item["status"] = _status(item.get("status"))
        item["hard"] = bool(item.get("hard", False))
        normalized.append(item)
    hard_fail = [c for c in normalized if c["hard"] and c["status"] == "fail"]
    hard_unknown = [c for c in normalized if c["hard"] and c["status"] == "unknown"]
    soft_fail = [c for c in normalized if not c["hard"] and c["status"] == "fail"]
    failed = hard_fail + soft_fail
    unknown = [c for c in normalized if c["status"] == "unknown"]

    reasons = []
    missing = []
    if hard_fail:
        verdict, route, confidence = "FAIL", "LOCAL_ONLY", 0.99
        reasons.append("One or more hard checks failed.")
    elif conflicts:
        verdict, route, confidence = "NEED_SOL", "SOL_RECOMMENDED", 0.95
        reasons.append("Evidence is contradictory.")
    elif deep or (soft_fail and uncertainties):
        verdict, route, confidence = "NEED_SOL", "SOL_RECOMMENDED", 0.85
        reasons.append("Non-deterministic reasoning is required.")
    elif hard_unknown or unknown or uncertainties:
        verdict, route, confidence = "UNKNOWN", "GATHER_EVIDENCE", 0.9
        reasons.append("Required evidence is incomplete.")
    else:
        verdict, route, confidence = "PASS", "LOCAL_ONLY", 0.98
        reasons.append("All supplied checks passed with no unresolved uncertainty.")
    for item in failed[:8]:
        reasons.append(f"{item.get('name','check')}: FAIL")
    for item in unknown[:8]:
        missing.append(item.get("name", "unnamed check"))
    missing.extend(str(x) for x in uncertainties[:8])

    risk = str(payload.get("risk", "medium")).upper()
    if hard_fail and risk not in {"CRITICAL", "HIGH"}:
        risk = "HIGH"
    relevant = [
        {
            "name": c.get("name", "check"),
            "status": c["status"],
            "hard": c["hard"],
            "evidence": c.get("evidence"),
        }
        for c in normalized if c["status"] != "pass"
    ][:12]
    sol_payload = {
        "task": payload.get("task"),
        "risk": risk,
        "failed_or_unknown_checks": relevant,
        "conflicts": conflicts[:8],
        "uncertainties": uncertainties[:8],
        "compact_context": payload.get("compact_context"),
    }
    return {
        "verdict": verdict,
        "route": route,
        "confidence": confidence,
        "risk": risk,
        "reasons": reasons[:12],
        "missing_evidence": missing[:12],
        "sol_payload": sol_payload,
    }

def main():
    parser = argparse.ArgumentParser(description="Local context reducer and decision gate")
    sub = parser.add_subparsers(dest="command", required=True)
    p_reduce = sub.add_parser("reduce")
    p_reduce.add_argument("--input", default="-")
    p_reduce.add_argument("--max-lines", type=int, default=80)
    p_reduce.add_argument("--context", type=int, default=1)
    p_judge = sub.add_parser("judge")
    p_judge.add_argument("--input", default="-")
    p_pipe = sub.add_parser("pipeline")
    p_pipe.add_argument("--input", required=True)
    p_pipe.add_argument("--evidence", required=True)
    p_pipe.add_argument("--max-lines", type=int, default=80)
    p_pipe.add_argument("--context", type=int, default=1)
    args = parser.parse_args()

    if args.command == "reduce":
        result = reduce_text(read_text(args.input), args.max_lines, args.context)
    elif args.command == "judge":
        result = judge(json.loads(read_text(args.input)))
    else:
        payload = json.loads(read_text(args.input))
        reduced = reduce_text(read_text(args.evidence), args.max_lines, args.context)
        payload["compact_context"] = reduced["compact_text"]
        result = judge(payload)
        result["reduction"] = {k: v for k, v in reduced.items() if k != "compact_text"}
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
