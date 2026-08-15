"""Fail-closed research OOS/forward permission guard.

This tool is research infrastructure only. It reads the frozen candidate
registry and refuses Fresh OOS or forward-paper access unless that exact action
is explicitly permitted for the pair. It does not access market data, VPS,
production, LIVE, or order paths.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

REGISTRY = Path("research/registry/research-candidate-registry-20260815.json")
PURPOSE_TO_FIELD = {
    "fresh-oos": "freshOosPermission",
    "forward-paper": "forwardPaperPermission",
    "live": "liveEligible",
    "retune": "retuneAllowed",
}


def load_registry() -> dict:
    data = json.loads(REGISTRY.read_text(encoding="utf-8"))
    if data.get("researchOnly") is not True:
        raise RuntimeError("REGISTRY_NOT_RESEARCH_ONLY")
    if any(data.get(k) is not False for k in ("productionChanged", "vpsChanged", "liveChanged", "realTradingEnabled")):
        raise RuntimeError("REGISTRY_PRODUCTION_BOUNDARY_BROKEN")
    return data


def check(symbol: str, purpose: str) -> tuple[bool, str]:
    data = load_registry()
    symbol = symbol.upper()
    if purpose not in PURPOSE_TO_FIELD:
        return False, f"UNKNOWN_PURPOSE:{purpose}"
    pair = data.get("pairs", {}).get(symbol)
    if pair is None:
        return False, f"UNKNOWN_PAIR:{symbol}"
    field = PURPOSE_TO_FIELD[purpose]
    allowed = pair.get(field) is True
    if allowed:
        return True, f"RESEARCH_FIREWALL_PASS:{symbol}:{purpose}:{pair.get('state')}"
    return False, f"RESEARCH_FIREWALL_BLOCK:{symbol}:{purpose}:{pair.get('state')}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--purpose", required=True, choices=sorted(PURPOSE_TO_FIELD))
    parser.add_argument("--expect", choices=("pass", "block"), default="pass")
    args = parser.parse_args()
    allowed, message = check(args.symbol, args.purpose)
    print(message)
    expected = args.expect == "pass"
    if allowed != expected:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
