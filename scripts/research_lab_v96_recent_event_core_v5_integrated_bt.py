from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stock-cache-dir", required=True)
    parser.add_argument("--pengu-replay", required=True)
    parser.add_argument("--v96-event-v5", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)
    source = json.loads(Path(args.v96_event_v5).read_text(encoding="utf-8"))
    compat = dict(source)
    compat["selectedBeatsPreviousT8"] = bool(source["selectedBeats86p139"])
    compat_path = output / "v96-v5-compat-for-integrator.json"
    compat_path.write_text(json.dumps(compat, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    subprocess.run([
        sys.executable, "scripts/research_lab_v96_recent_event_core_v2_integrated_bt.py",
        "--stock-cache-dir", args.stock_cache_dir,
        "--pengu-replay", args.pengu_replay,
        "--v96-event-v2", str(compat_path),
        "--output-dir", str(output),
    ], check=True)
    interim = output / "v96-recent-event-core-v2-integrated.json"
    result = json.loads(interim.read_text(encoding="utf-8"))
    result["status"] = (
        "V96_EVENT_V5_INTEGRATED_PASS"
        if result["status"] == "V96_EVENT_V2_INTEGRATED_PASS" and source["selectedBeats86p139"]
        else "V96_EVENT_V5_INTEGRATED_DIAGNOSTIC"
    )
    result["researchStatus"] = source["status"]
    result["selected"] = source["selected"]
    result["checks"]["selectedBeats86p139"] = bool(source["selectedBeats86p139"])
    result["checks"].pop("selectedBeatsT8", None)
    result["redesignedResult"]["strategyId"] = "DISDEX_V96_RECENT_EVENT_CORE_V5_PLUS_PENGU_DUAL_LS_V1_PLUS_V52_UNIFIED_BT"
    result["redesignedResult"]["architecture"]["v96"] = (
        f"V96_RECENT_EVENT_CORE_V5_HIGH_RETURN_SHORT_PULLBACK ({source['selected']['variantId']}); legacy V96 unchanged"
    )
    target = output / "v96-recent-event-core-v5-integrated.json"
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    c = result["comparison"]
    lines = [
        "# V96 Recent Event Core V5 — Integrated Portfolio", "",
        f"- Status: **{result['status']}**",
        f"- Selected: **{source['selected']['variantId']}**",
        f"- V96 sleeve: {c['baseline']['v96SleeveFull']['compoundedReturnPct']}% -> **{c['redesigned']['v96SleeveFull']['compoundedReturnPct']}%**",
        f"- Portfolio NORMAL: {c['baseline']['normalFull']['compoundedReturnPct']}% -> **{c['redesigned']['normalFull']['compoundedReturnPct']}%**",
        f"- Portfolio DD: {c['baseline']['normalFull']['maxDrawdownPct']}% -> **{c['redesigned']['normalFull']['maxDrawdownPct']}%**",
        f"- Portfolio PF: {c['baseline']['normalFull']['profitFactor']} -> **{c['redesigned']['normalFull']['profitFactor']}**",
        f"- Reused 2026-03-11 window: {c['baseline']['reused20260311Window']['compoundedReturnPct']}% -> **{c['redesigned']['reused20260311Window']['compoundedReturnPct']}%**",
        f"- Severe Full: {c['baseline']['severeFull']['compoundedReturnPct']}% -> **{c['redesigned']['severeFull']['compoundedReturnPct']}%**",
        "- Production / LIVE / VPS / orders changed: **NO**",
    ]
    (output / "v96-recent-event-core-v5-integrated.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
