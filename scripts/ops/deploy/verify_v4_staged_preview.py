#!/usr/bin/env python3
"""Verify a temporary V4 preview; this never creates a production release."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

import build_v4_staged_overlay as overlay

ROOT = Path(__file__).resolve().parents[3]
TESTS = ROOT / "deploy/v4-staged-overlay/tests"
NODE_MODULES = ROOT / "node_modules"


def run(argv: list[str], *, cwd: Path, env: dict[str, str]) -> None:
    result = subprocess.run(argv, cwd=cwd, env=env, capture_output=True,
                            text=True, encoding="utf-8", errors="replace", timeout=180)
    print("CHECK", Path(argv[-1]).name, "exit", result.returncode, flush=True)
    if result.returncode:
        print((result.stdout + result.stderr).encode("ascii", "backslashreplace").decode("ascii"))
        raise RuntimeError("V4_PREVIEW_VERIFICATION_FAILED")


def main() -> int:
    tsx = NODE_MODULES / "tsx/dist/cli.mjs"
    loader = NODE_MODULES / "tsx/dist/loader.mjs"
    tsc = NODE_MODULES / "typescript/bin/tsc"
    if not all(path.is_file() for path in (tsx, loader, tsc)):
        raise RuntimeError("V4_PREVIEW_DEPENDENCIES_MISSING")
    with tempfile.TemporaryDirectory(prefix="disdex-v4-preview-") as directory:
        preview = Path(directory) / "preview"
        result = overlay.build(ROOT, preview, "a" * 40)
        if result.get("productionRelease") is not False or (preview / ".disdex-release-sha").exists():
            raise RuntimeError("V4_PREVIEW_UNEXPECTED_RELEASE_MARKER")
        names = ("v12-v4-monitor-only.test.ts", "v4-dynamic-evidence-auth-boundary.test.ts",
                 "runner-tick-heartbeat.test.ts", "v12-v4-monitor-systemd.test.mjs",
                 "pending-exposure-readonly-reconcile.test.ts")
        for name in names:
            dest = preview / "tests" / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(TESTS / (name + ".src"), dest)
        snapshot = Path("scripts/ops/root/disdex-runner-health-snapshot-v2.mjs")
        dest = preview / snapshot
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / snapshot, dest)
        env = os.environ.copy()
        env["NODE_PATH"] = str(NODE_MODULES) + (os.pathsep + env["NODE_PATH"] if env.get("NODE_PATH") else "")
        for name in (names[0], names[1], names[4]):
            run(["node", str(tsx), str(preview / "tests" / name)], cwd=preview, env=env)
        run(["node", str(preview / "tests" / names[3])], cwd=preview, env=env)
        pattern = ("tick filenames|a V4 writer|writes an atomic|replaces an existing|"
                   "requires explicit|same-PID|80 concurrent|rejects invalid")
        run(["node", "--import", loader.as_uri(), "--test", "--test-name-pattern=" + pattern,
             str(preview / "tests" / names[2])], cwd=preview, env=env)
        config = {
            "compilerOptions": {
                "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
                "strict": True, "skipLibCheck": True, "noEmit": True, "esModuleInterop": True,
                "allowJs": True, "baseUrl": str(preview),
                "paths": {"@/*": ["./*"], "nodemailer": [str(NODE_MODULES / "@types/nodemailer")],
                          "*": [str(NODE_MODULES / "*")]},
                "typeRoots": [str(NODE_MODULES / "@types")], "types": ["node"],
            },
            "files": ["lib/v12-v4-monitor-only.ts", "lib/disdex-runner-tick-heartbeat.ts",
                      "scripts/v12-v4-monitor-only-runner.ts",
                      "scripts/ops/root/disdex-v4-dynamic-evidence-refresh.ts",
                      "scripts/ops/root/disdex-pending-exposure-readonly-reconcile.ts"],
        }
        config_path = preview / "tsconfig.preview-check.json"
        config_path.write_text(json.dumps(config), encoding="utf-8")
        run(["node", str(tsc), "-p", str(config_path), "--pretty", "false"], cwd=preview, env=env)
    print("V4_PREVIEW_VERIFIED_NOT_LIVE", flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print("V4_PREVIEW_BLOCKED:" + str(error), file=sys.stderr)
        sys.exit(1)
