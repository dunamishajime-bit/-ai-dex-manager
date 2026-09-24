"""Audit historical provenance before allowing any formal integrated result.

Run from repo root:
  python -m scripts.research.canonical_integrated_bt --mode audit
  python -m scripts.research.canonical_integrated_bt --mode replay-synthetic \
      --events /path/to/synthetic.json --policy /path/to/synthetic-policy.json

Synthetic mode is explicitly NOT a production or formal PENGU comparison.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .core import ReplayError, replay_synthetic, required_anchor_evidence
from .source_bundle import inspect_source_bundle

DEFAULT_MANIFEST = Path(__file__).with_name("anchor-source-manifest.json")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Canonical integrated BT evidence gate (research-only)")
    parser.add_argument("--mode", choices=("audit", "compare", "discover-source", "replay-synthetic"), required=True)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--bundle-manifest", type=Path)
    parser.add_argument("--source-root", type=Path)
    parser.add_argument("--events", type=Path)
    parser.add_argument("--policy", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)

    def emit(payload: dict) -> None:
        rendered = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(rendered, encoding="utf-8")
        print(rendered, end="")

    try:
        if args.mode == "replay-synthetic":
            if not args.events or not args.policy:
                parser.error("replay-synthetic requires --events and --policy")
            events = json.loads(args.events.read_text(encoding="utf-8"))
            policy = json.loads(args.policy.read_text(encoding="utf-8"))
            if not isinstance(events, list) or not isinstance(policy, dict):
                raise ReplayError("INVALID_SYNTHETIC_INPUT")
            emit(replay_synthetic(events, policy))
            return 0
        if args.mode == "discover-source":
            if not args.bundle_manifest:
                parser.error("discover-source requires --bundle-manifest")
            result = inspect_source_bundle(args.bundle_manifest, args.source_root)
            emit(result)
            return 0 if result["status"] == "SOURCE_BUNDLE_VERIFIED" else 2
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
        if not isinstance(manifest, dict):
            raise ReplayError("MANIFEST_NOT_OBJECT")
        missing = required_anchor_evidence(manifest)
        if missing:
            emit({
                "status": "BLOCKED_MISSING_CANONICAL_SOURCE",
                "missing_evidence": missing,
                "formal_results": None,
                "source_manifest": str(args.manifest),
                "hint": "Recover original anchor run, causal ledgers, data hashes, and source-specific allocator.",
            })
            return 2
        if args.mode == "audit":
            emit({
                "status": "MANIFEST_FIELDS_PRESENT_NOT_AUTHENTICATED",
                "formal_results": None,
                "hint": "Codex must verify hashes against actual datasets and perform baseline parity.",
            })
            return 3
        emit({
            "status": "BLOCKED_MISSING_CANONICAL_ADAPTERS",
            "formal_results": None,
            "hint": "Create source-backed V12/FET/Q102/V52 ledgers, original allocator, and G1 baseline parity before PENGU swap.",
        })
        return 3
    except (OSError, json.JSONDecodeError, ReplayError) as exc:
        emit({"status": "BLOCKED_INVALID_INPUT", "formal_results": None, "error": str(exc)})
        return 4


if __name__ == "__main__":
    sys.exit(main())
