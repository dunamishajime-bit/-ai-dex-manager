from __future__ import annotations

import argparse
import csv
import importlib.util
import json
import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import research_flat_boost_preemption_20260918 as residual

Q102_FRONTIER = {
    "HIGH_VOL": 1.665,
    "MR": 1.0,
    "BRK": 2.475,
    "REV": 2.5,
    "PB": 2.5,
}
EXPECTED = {
    "NORMAL": {"V12_ENTERED": 874, "PENGU_ENTERED": 66, "V11_EQ_ENTERED": 50,
               "V50_POST_OPEN_BASIS_ENTERED": 93, "SUPPLEMENT_ENTERED": 69},
    "SEVERE": {"V12_ENTERED": 871, "PENGU_ENTERED": 66, "V11_EQ_ENTERED": 0,
               "V50_POST_OPEN_BASIS_ENTERED": 0, "SUPPLEMENT_ENTERED": 69},
}
def load_engine(canonical_runner: Path):
    os.environ.setdefault("SUPPLEMENT_GROSS_CAP", "2.5")
    source = residual.build_exact_source(canonical_runner)
    generated = ROOT / "scripts" / f".generated-all-sleeves-{os.getpid()}.py"
    generated.write_text(source, encoding="utf-8")
    spec = importlib.util.spec_from_file_location("disdex_all_sleeves_engine", generated)
    if spec is None or spec.loader is None:
        raise RuntimeError("ENGINE_IMPORT_SPEC_FAILED")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, generated


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def iso_ms(text: str) -> int:
    import datetime as dt
    return int(dt.datetime.fromisoformat(text).timestamp() * 1000)


def supplement_rows(engine, frozen: list[dict], scenario: str, family_caps: dict[str, float]) -> list[dict]:
    supp_col = "normal_net" if scenario == "NORMAL" else "stress_net"
    rows = []
    for row in frozen:
        family = row["family"]
        cap = float(family_caps.get(family, 1.0))
        rows.append({
            "entryTs": iso_ms(row["entry"]),
            "exitTs": iso_ms(row["exit"]),
            "symbol": row["symbol"],
            "layer": row["layer"],
            "family": family,
            "requestedGross": cap,
            "side": int(row.get("side", 0)),
            "feePerSide": 0.0006 if scenario == "NORMAL" else 0.0010,
            "fundingPerDay": 0.0002 if scenario == "NORMAL" else 0.0005,
            "netUnitReturn": engine.finite(row[supp_col]),
            "exitReason": row.get("exit_reason") or "QUALITY_FROZEN_EXIT",
        })
    return rows


def apply_config(engine, cfg: dict[str, Any]) -> None:
    engine.TOTAL_GROSS_CAP = 3.5
    engine.CRYPTO_GROSS_CAP = 3.0
    engine.V12_GROSS_CAP = float(cfg["v12Gross"])
    engine.V12_PER_POSITION_GROSS_CAP = float(cfg.get("v12PerPosition", 1.0))
    engine.V12_MAX_POSITIONS = 2
    engine.PENGU_MAX_GROSS = float(cfg["penguGross"])
    engine.STOCK_GROSS_CAP = float(cfg["stockGross"])
    engine.V11_GROSS_CAP = float(cfg["stockSlot"])
    engine.V50_GROSS_CAP = float(cfg["stockSlot"])
    engine.SUPPLEMENT_GROSS_CAP = max(float(v) for v in cfg["q102FamilyCaps"].values())
    engine.SUPPLEMENT_AGGREGATE_GROSS_CAP = engine.SUPPLEMENT_GROSS_CAP


def summarize(engine, result: dict, scenario: str, cfg: dict[str, Any]) -> dict:
    routing = result["routingDiagnostics"]
    gross = result["grossVerification"]
    parity = all(int(routing.get(k, 0)) == v for k, v in EXPECTED[scenario].items())
    conflicts = len(gross.get("supplementGrossConflicts", []))
    return {
        "scenario": scenario,
        "name": cfg["name"],
        "v12Gross": cfg["v12Gross"],
        "penguGross": cfg["penguGross"],
        "stockGross": cfg["stockGross"],
        "stockSlot": cfg["stockSlot"],
        "endingAssetJpy": result["endingAssetJpy"],
        "profitFactor": result["profitFactor"],
        "maxDrawdownPct": result["maxDrawdownPctClosedEventTwr"],
        "trades": result["trades"],
        "maxV12Gross": gross["entryTimeMaxV12Gross"],
        "maxPenguGross": gross["entryTimeMaxPenguGross"],
        "maxStockGross": gross["entryTimeMaxStockGross"],
        "maxCryptoGross": gross["entryTimeMaxCryptoGross"],
        "maxTotalGross": gross["entryTimeMaxTotalGross"],
        "grossConflicts": conflicts,
        "coreFillParity": parity,
        "strictDd20Pass": float(result["maxDrawdownPctClosedEventTwr"]) >= -20.0,
        "routing": {k: int(routing.get(k, 0)) for k in EXPECTED[scenario]},
        "routingScale": {
            "V12_GROSS_SCALED": int(routing.get("V12_GROSS_SCALED", 0)),
            "PENGU_GROSS_SCALED": int(routing.get("PENGU_GROSS_SCALED", 0)),
            "V11_EQ_GROSS_SCALED": int(routing.get("V11_EQ_GROSS_SCALED", 0)),
            "V50_POST_OPEN_BASIS_GROSS_SCALED": int(routing.get("V50_POST_OPEN_BASIS_GROSS_SCALED", 0)),
            "SUPPLEMENT_GROSS_RESIZED": int(routing.get("SUPPLEMENT_GROSS_RESIZED", 0)),
        },
        "allocationGrossSum": {
            sleeve: sum(float(e.get("allocatedGrossAtEntry", 0.0)) for e in result["events"]
                        if e.get("sleeve") == sleeve and e.get("strategy") != "SUPPLEMENT_QUALITY102_TRIM")
            for sleeve in ("V12", "PENGU_DUAL_LS_V2", "V52", "SUPPLEMENT_QUALITY102")
        },
        "bySleeve": result["bySleeve"],
    }


def configs() -> list[dict[str, Any]]:
    base = {"v12Gross": 1.5, "v12PerPosition": 1.0, "penguGross": 0.85, "stockGross": 1.5,
            "stockSlot": 1.0, "q102FamilyCaps": Q102_FRONTIER}
    out = [{"name": "Q102_FRONTIER_BASE", **base}]
    for cap in (1.525, 1.55, 1.575, 1.6, 1.65, 1.7, 1.8, 2.0):
        out.append({"name": f"V12_{cap:g}", **base, "v12Gross": cap})
    for cap in (0.875, 0.9, 0.925, 0.95, 1.0, 1.1, 1.25):
        out.append({"name": f"PENGU_{cap:g}", **base, "penguGross": cap})
    for stock_gross, slot in (
        (1.5, 1.1), (1.5, 1.2), (1.5, 1.25), (1.5, 1.5),
        (1.75, 1.1), (1.75, 1.25), (1.75, 1.5), (1.75, 1.6), (1.75, 1.75),
        (1.8, 1.5), (1.8, 1.6), (1.8, 1.75),
        (1.85, 1.5), (1.85, 1.6), (1.85, 1.75),
        (1.9, 1.5), (1.9, 1.6), (1.9, 1.75),
        (1.95, 1.5), (1.95, 1.6), (1.95, 1.625), (1.95, 1.65), (1.95, 1.675), (1.95, 1.7), (1.95, 1.75),
        (1.975, 1.5), (1.975, 1.6), (1.975, 1.625), (1.975, 1.65), (1.975, 1.675), (1.975, 1.7),
        (1.99, 1.5), (1.99, 1.6), (1.99, 1.625), (1.99, 1.65), (1.99, 1.675), (1.99, 1.7),
        (2.0, 1.1), (2.0, 1.25), (2.0, 1.5), (2.0, 1.6), (2.0, 1.625), (2.0, 1.65), (2.0, 1.675), (2.0, 1.7), (2.0, 1.75),
    ):
        out.append({"name": f"V52_G{stock_gross:g}_S{slot:g}", **base,
                    "stockGross": stock_gross, "stockSlot": slot})
    for stock_gross in (1.976, 1.978, 1.98, 1.982, 1.984, 1.986, 1.988):
        for slot in (1.626, 1.628, 1.63, 1.632, 1.635, 1.64, 1.645):
            out.append({"name": f"V52_FINE_G{stock_gross:g}_S{slot:g}", **base,
                        "stockGross": stock_gross, "stockSlot": slot})
    for stock_gross in (1.9822, 1.9824, 1.9826, 1.9828, 1.9830, 1.9832, 1.9834, 1.9836, 1.9838):
        out.append({"name": f"V52_EDGE_G{stock_gross:g}_S1.645", **base,
                    "stockGross": stock_gross, "stockSlot": 1.645})
    for slot in (1.6455, 1.646, 1.6465, 1.647, 1.6475, 1.648, 1.6485, 1.649):
        out.append({"name": f"V52_EDGE_G1.982_S{slot:g}", **base,
                    "stockGross": 1.982, "stockSlot": slot})
    for stock_gross in (1.9824, 1.9828, 1.9830, 1.9832, 1.9834):
        for slot in (1.6480, 1.6485, 1.6490, 1.6492, 1.6494, 1.6496, 1.6498):
            out.append({"name": f"V52_CORNER_G{stock_gross:g}_S{slot:g}", **base,
                        "stockGross": stock_gross, "stockSlot": slot})
    for v12_gross in (1.3, 1.35, 1.4, 1.45, 1.475, 1.5):
        for pengu in (0.85, 0.875, 0.9, 0.925, 0.95, 1.0):
            out.append({"name": f"REALLOC_V12{v12_gross:g}_P{pengu:g}", **base,
                        "v12Gross": v12_gross, "penguGross": pengu,
                        "stockGross": 1.98, "stockSlot": 1.64})
    for v12_pp in (0.9, 0.95):
        for pengu in (0.875, 0.9, 0.925, 0.95, 1.0):
            out.append({"name": f"REALLOC_V12PP{v12_pp:g}_P{pengu:g}", **base,
                        "v12PerPosition": v12_pp, "v12Gross": 1.5, "penguGross": pengu,
                        "stockGross": 1.98, "stockSlot": 1.64})
    for hv in (1.4, 1.5, 1.55, 1.6, 1.625, 1.65, 1.665):
        for pengu in (0.85, 0.875, 0.9, 0.925, 0.95):
            caps = {**Q102_FRONTIER, "HIGH_VOL": hv}
            out.append({"name": f"JOINT_HV{hv:g}_P{pengu:g}_V52", **base,
                        "penguGross": pengu, "stockGross": 1.975, "stockSlot": 1.625,
                        "q102FamilyCaps": caps})
    for hv in (1.5, 1.6, 1.65):
        for brk in (2.3, 2.4, 2.475):
            for pengu in (0.875, 0.9, 0.925):
                caps = {**Q102_FRONTIER, "HIGH_VOL": hv, "BRK": brk}
                out.append({"name": f"JOINT_HV{hv:g}_B{brk:g}_P{pengu:g}_V52", **base,
                            "penguGross": pengu, "stockGross": 1.975, "stockSlot": 1.625,
                            "q102FamilyCaps": caps})
    return out


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--v12-ledger", required=True)
    p.add_argument("--pengu-ledger", required=True)
    p.add_argument("--q102-csv", required=True)
    p.add_argument("--stock-cache-dir", required=True)
    p.add_argument("--canonical-runner", required=True)
    p.add_argument("--output", required=True)
    args = p.parse_args()

    engine, generated = load_engine(Path(args.canonical_runner))
    try:
        v12 = load_json(Path(args.v12_ledger))
        pengu = load_json(Path(args.pengu_ledger))
        v11_rows, v50_rows, _target_days, stock_diag = engine.build_stock(Path(args.stock_cache_dir))
        with Path(args.q102_csv).open(newline="", encoding="utf-8") as handle:
            frozen = list(csv.DictReader(handle))
        if len(frozen) != 90:
            raise RuntimeError(f"Q102_EXPECTED_90_GOT_{len(frozen)}")

        rows = []
        for cfg in configs():
            apply_config(engine, cfg)
            for scenario, assumptions in engine.SCENARIOS.items():
                mode = str(assumptions["ledgerMode"])
                supp = supplement_rows(engine, frozen, scenario, cfg["q102FamilyCaps"])
                result = engine.simulate(
                    v12["modes"][mode]["trades"],
                    pengu["modes"][mode]["trades"],
                    v11_rows,
                    v50_rows,
                    engine.finite(assumptions["stockCostBps"]),
                    supp,
                )
                rows.append(summarize(engine, result, scenario, cfg))

        by_name: dict[str, dict[str, dict]] = {}
        for row in rows:
            by_name.setdefault(row["name"], {})[row["scenario"]] = row
        accepted = []
        for name, pair in by_name.items():
            if set(pair) != {"NORMAL", "SEVERE"}:
                continue
            if all(pair[m]["strictDd20Pass"] and pair[m]["coreFillParity"] and
                   pair[m]["grossConflicts"] == 0 and pair[m]["maxCryptoGross"] <= 3.0 + 1e-9 and
                   pair[m]["maxTotalGross"] <= 3.5 + 1e-9 for m in ("NORMAL", "SEVERE")):
                accepted.append({
                    "name": name,
                    "normalAsset": pair["NORMAL"]["endingAssetJpy"],
                    "normalDd": pair["NORMAL"]["maxDrawdownPct"],
                    "severeAsset": pair["SEVERE"]["endingAssetJpy"],
                    "severeDd": pair["SEVERE"]["maxDrawdownPct"],
                })
        accepted.sort(key=lambda x: (x["normalAsset"], x["severeAsset"]), reverse=True)
        payload = {
            "schema": "all-sleeves-dynamic-gross-sweep/v1",
            "researchOnly": True,
            "q102Frontier": Q102_FRONTIER,
            "portfolioCaps": {"crypto": 3.0, "total": 3.5},
            "rows": rows,
            "acceptedStrictDd20": accepted,
            "stockDiagnostics": stock_diag,
            "safety": {"ordersSent": False, "liveChanged": False, "vpsChanged": False,
                       "productionChanged": False},
        }
        out = Path(args.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"accepted": accepted[:10], "count": len(rows)}, ensure_ascii=False, indent=2))
    finally:
        generated.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
