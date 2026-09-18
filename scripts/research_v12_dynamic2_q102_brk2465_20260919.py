from __future__ import annotations
import csv
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import research_v12_dynamic_residual_boost_20260919 as dyn

FINAL_Q102_CAPS = {"HIGH_VOL": 1.665, "MR": 1.0, "BRK": 2.465, "REV": 2.5, "PB": 2.5}
DYNAMIC_CAP = 2.0

def main() -> None:
    src = Path(os.environ.get("RESEARCH_SOURCE_ROOT", str(ROOT)))
    v12_path = src / ".research-state" / "btc-q102x1-sweep" / "v12-q54-atr0p014.json"
    pengu_path = src / ".research-state" / "btc-q102x1-sweep" / "pengu-hard-cooldown" / "pengu-hard-cd24.json"
    q102_path = src / ".research-state" / "btc-q102x1-sweep" / "candidate-1slot.csv"
    stock_path = src / ".research-state" / "q102-2slot-compare" / "inputs" / "stock-cache"
    runner = src / ".research-state" / "btc-q102x1-sweep" / "run_canonical_margin_compare.py"
    funding = Path(os.environ.get("V12_DYNAMIC_FUNDING", str(ROOT / ".research-state" / "v12-dynamic-residual" / "funding.json")))

    missing = [str(p) for p in (v12_path, pengu_path, q102_path, stock_path, runner, funding) if not p.exists()]
    if missing:
        raise RuntimeError("MISSING_RESEARCH_INPUTS:" + "|".join(missing))

    dyn.Q102_CAPS = dict(FINAL_Q102_CAPS)
    engine, generated = dyn.load_dynamic_engine(runner, funding)
    try:
        v12 = json.loads(v12_path.read_text(encoding="utf-8"))
        pengu = json.loads(pengu_path.read_text(encoding="utf-8"))
        v11, v50, _, stock_diag = engine.build_stock(stock_path)
        with q102_path.open(newline="", encoding="utf-8") as f:
            frozen = list(csv.DictReader(f))

        expected = {
            "NORMAL": {"V12_ENTERED": 874, "PENGU_ENTERED": 66, "V11_EQ_ENTERED": 50, "V50_POST_OPEN_BASIS_ENTERED": 93, "SUPPLEMENT_ENTERED": 69},
            "SEVERE": {"V12_ENTERED": 871, "PENGU_ENTERED": 66, "V11_EQ_ENTERED": 0, "V50_POST_OPEN_BASIS_ENTERED": 0, "SUPPLEMENT_ENTERED": 69},
        }
        rows = []
        for scenario in ("NORMAL", "SEVERE"):
            result = dyn.run_case(engine, v12, pengu, frozen, v11, v50, scenario, DYNAMIC_CAP)
            routing = result["routingDiagnostics"]
            gross = result["grossVerification"]
            row = {
                "scenario": scenario,
                "endingAssetJpy": result["endingAssetJpy"],
                "profitFactor": result["profitFactor"],
                "maxDrawdownPct": result["maxDrawdownPctClosedEventTwr"],
                "trades": result["trades"],
                "coreFillParity": all(int(routing.get(k, 0)) == v for k, v in expected[scenario].items()),
                "grossConflicts": len(gross["supplementGrossConflicts"]),
                "maxCryptoGross": gross["entryTimeMaxCryptoGross"],
                "maxTotalGross": gross["entryTimeMaxTotalGross"],
                "routing": {k: int(routing.get(k, 0)) for k in expected[scenario]},
                "boostEntries": int(routing.get("V12_DYNAMIC_BOOST_ENTRIES", 0)),
                "boostTrims": int(routing.get("V12_DYNAMIC_BOOST_TRIMS", 0)),
                "boostGrossAllocated": int(routing.get("V12_DYNAMIC_BOOST_GROSS_MILLI", 0)) / 1000.0,
            }
            row["strictPass"] = (
                row["coreFillParity"] and row["grossConflicts"] == 0 and
                row["maxDrawdownPct"] >= -20.0 and
                row["maxCryptoGross"] <= 3.0 + 1e-9 and row["maxTotalGross"] <= 3.5 + 1e-9
            )
            rows.append(row)

        payload = {
            "schema": "v12-dynamic2-q102-brk2465/v1",
            "status": "PASS_RESEARCH_ONLY" if all(r["strictPass"] for r in rows) else "FAIL_RESEARCH_CONTRACT",
            "period": {"startInclusive": "2025-08-10T00:00:00.000Z", "endExclusive": "2026-08-10T00:00:00.000Z"},
            "configuration": {
                "v12BaseAggregateGross": 1.5,
                "v12DynamicAggregateGrossCap": 2.0,
                "v12PerPositionGrossCap": 1.0,
                "penguGross": 0.85,
                "q102FamilyCaps": FINAL_Q102_CAPS,
                "v52StockGross": 1.98,
                "v52SlotGross": 1.64,
                "cryptoGrossCap": 3.0,
                "totalGrossCap": 3.5,
                "sharedCryptoDailyLossPct": 7.5,
            },
            "results": rows,
            "stockDiagnostics": stock_diag,
            "safety": {"ordersSent": False, "liveChanged": False, "vpsChanged": False, "productionChanged": False},
        }
        out = ROOT / "docs" / "research-results" / "v12-dynamic2-q102-brk2465-20260919.json"
        out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        if payload["status"] != "PASS_RESEARCH_ONLY":
            raise SystemExit(2)
    finally:
        generated.unlink(missing_ok=True)

if __name__ == "__main__":
    main()
