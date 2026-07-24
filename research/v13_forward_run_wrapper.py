from __future__ import annotations

import argparse
import asyncio
import json
import subprocess
import sys
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the frozen V13 collector with an external no-new-entry cutoff."
    )
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--duration-seconds", type=int, required=True)
    parser.add_argument("--entry-cutoff-ms", type=int, required=True)
    parser.add_argument("--output-dir", required=True)
    return parser.parse_args()


def load_frozen_modules(source_root: Path, expected_commit: str) -> tuple[Any, Any]:
    research_dir = source_root / "research"
    if not research_dir.is_dir():
        raise RuntimeError(f"Frozen research directory is missing: {research_dir}")
    if not (source_root / ".git").exists():
        raise RuntimeError("Frozen source checkout is missing Git metadata")
    sys.path.insert(0, str(research_dir))
    import v96_stock_cross_venue_orderflow_v13_engine_base as engine_base
    import v96_stock_cross_venue_orderflow_v13 as collector

    actual = subprocess.check_output(
        ["git", "-C", str(source_root), "rev-parse", "HEAD"], text=True
    ).strip()
    if actual != expected_commit:
        raise RuntimeError(
            f"Frozen source mismatch: expected {expected_commit}, got {actual}"
        )
    return engine_base, collector


def main() -> int:
    args = parse_args()
    if args.duration_seconds <= 0:
        raise ValueError("duration-seconds must be positive")
    source_root = Path(args.source_root).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    engine_base, collector = load_frozen_modules(source_root, args.source_commit)
    collector.self_test()
    original_session_gate = engine_base.us_regular_session

    def frozen_forward_session_gate(received_ms: int) -> bool:
        return original_session_gate(received_ms) and received_ms < args.entry_cutoff_ms

    engine_base.us_regular_session = frozen_forward_session_gate
    result = asyncio.run(collector.probe(args.duration_seconds, output_dir))
    wrapper_meta = {
        "sourceCommit": args.source_commit,
        "entryCutoffMs": args.entry_cutoff_ms,
        "durationSeconds": args.duration_seconds,
        "resultStatus": result.get("status"),
        "safety": result.get("safety"),
    }
    (output_dir / "wrapper-metadata.json").write_text(
        json.dumps(wrapper_meta, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "strategyId": result.get("strategyId"),
                "status": result.get("status"),
                "entryCutoffMs": args.entry_cutoff_ms,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
