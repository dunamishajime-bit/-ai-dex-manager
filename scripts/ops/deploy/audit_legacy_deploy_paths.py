#!/usr/bin/env python3
"""Read-only GitHub Actions inventory: find old paths able to reach VPS root."""
import argparse
import json
from pathlib import Path
import re

OLD_KEY = re.compile(r"secrets\.(DISDEX_VPS_ROOT_PRIVATE_KEY|DISDEX_VPS_SSH_PRIVATE_KEY)")
ROOT_SSH = re.compile(r"(?:ssh|scp)\b[\s\S]{0,300}?(?:root@|DISDEX_VPS)", re.I)
MUTATIONS = re.compile(r"\bsystemctl\b|--apply\b|deploy\b|cutover\b|atomic_switch_current\b|"
                       r"\brm -rf\b|\bchown\b|\binstall -o\b|\bln -s\b", re.I)

def inventory(root):
    folder = Path(root) / ".github" / "workflows"
    if not folder.is_dir():
        raise ValueError("workflow directory missing")
    rows = []
    for file in sorted(list(folder.glob("*.yml")) + list(folder.glob("*.yaml"))):
        text = file.read_text(encoding="utf-8")
        if OLD_KEY.search(text) or ROOT_SSH.search(text):
            rows.append({
                "workflow": str(file.relative_to(root)).replace("\\", "/"),
                "legacyRootCredential": bool(OLD_KEY.search(text)),
                "possiblyWriteCapable": bool(MUTATIONS.search(text)),
                "workflowDispatch": "workflow_dispatch:" in text,
            })
    return rows

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--root", default=".")
    p.add_argument("--require-retired", action="store_true",
                   help="enable ONLY after new path and rollback are proven")
    a = p.parse_args()
    rows = inventory(a.root)
    print(json.dumps({"legacyVpsAccessWorkflowCount": len(rows),
                      "paths": rows}, indent=2))
    if a.require_retired and rows:
        print("DISDEX_LEGACY_DEPLOY_PATHS_STILL_PRESENT")
        return 1
    print("DISDEX_LEGACY_DEPLOY_INVENTORY_COMPLETE_READONLY")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
