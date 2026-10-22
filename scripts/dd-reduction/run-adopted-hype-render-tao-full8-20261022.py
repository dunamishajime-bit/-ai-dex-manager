#!/usr/bin/env python3
"""Pinned, explicit full-eight cumulative BT of the user-adopted HYPE+Idle policy.

Never runs older 2-rule alternative or the all-candidate comparison by default.
Requires an external output directory and checks both 10bps/30bps economic
anchors; research only, no VPS/Production/LIVE/order/HP actions.
"""
from __future__ import annotations
import argparse
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
POLICY_PATH = REPO / "config" / "research" / "hype-render-tao-cumulative-adopted-20261022.json"
ENGINE = Path(__file__).with_name("run-idle-five-entry-full8-after-hype-20261022.py")
EXPECTED_CASE = "TAO_RET1H_PLUS_RENDER_SKIP_AND_PROFIT"

def check_contract():
    cfg = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
    assert cfg["status"] == "USER_FORMALLY_ADOPTED_RESEARCH_CONTRACT_PENDING_PRODUCTION_INTEGRATION"
    assert cfg["sourceResearch"]["selectedIntegratedCaseId"] == EXPECTED_CASE
    assert cfg["hypeLong"]["noHypeShortCreated"] is True
    assert cfg["idlePriorityShort"]["doNotCreateIdleLongSignals"] is True
    assert cfg["idlePriorityShort"]["doNotModifySymbols"] == ["DOTUSDT", "TIAUSDT", "JUPUSDT"]
    assert cfg["implementationState"]["wiredIntoLiveRunner"] is False
    return cfg

def validate_output(path: Path, cfg: dict):
    source = path / "IDLE5_FULL8_AFTER_HYPE_20261022.json"
    report = json.loads(source.read_text(encoding="utf-8"))
    assert set(report["results"]) == {EXPECTED_CASE}
    runs = report["results"][EXPECTED_CASE]["costs"]
    assert set(runs) == {"10", "30"}
    for cost, key in (("10", "cost10bps"), ("30", "cost30bps")):
        result = runs[cost]
        anchor = cfg["modeledEightStrategyIntegratedBaseline"][key]
        assert result["accounting"] == "PASS"
        assert abs(result["finalEquityJpy"] - anchor["finalEquityJPY"]) < 0.20
        assert abs(result["maxMtmDdPct"] - anchor["maxMtmDrawdownPct"]) < 1e-7
        render = result["byIdleShortSymbol"]["RENDERUSDT"]
        tao = result["byIdleShortSymbol"]["TAOUSDT"]
        assert render["wins"] == anchor["renderShortWins"]
        assert render["losses"] == anchor["renderShortLosses"]
        assert tao["wins"] == anchor["taoShortWins"]
        assert tao["losses"] == anchor["taoShortLosses"]
        print("ADOPTED_FULL8_EXACT_PASS",cost,result["finalEquityJpy"],
              result["maxMtmDdPct"],render["wins"],render["losses"],
              tao["wins"],tao["losses"],flush=True)
    return True

def main():
    parser = argparse.ArgumentParser(description="Replay only formal HYPE + RENDER/TAO triple-rule cumulative baseline")
    parser.add_argument("--output", required=True, type=Path, help="External research output folder, use a short path on Windows")
    parser.add_argument("--validate-only", action="store_true", help="Only verify an already completed full8 result at --output")
    args = parser.parse_args()
    cfg = check_contract()
    dest = args.output.expanduser().resolve()
    assert REPO not in (dest, *dest.parents), "Do not store large private full8 ledgers inside the Git repository"
    if not args.validate_only:
        dest.mkdir(parents=True, exist_ok=True)
        command = [sys.executable, "-u", str(ENGINE), "--cases", EXPECTED_CASE, "--output", str(dest)]
        subprocess.run(command, check=True)
    validate_output(dest, cfg)
    print("FORMAL_USER_ADOPTION_VERIFIED_RESEARCH_NOT_LIVE",flush=True)

if __name__ == "__main__":
    main()
