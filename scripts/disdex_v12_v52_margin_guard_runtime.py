#!/usr/bin/env python3
"""V12/V52 systemd entrypoint binding to the canonical serialized Margin Guard.

This file exists because the systemd instance for the c731 release expected
this exact filename. The actual reviewed implementation is the V96/V52
serialized guard. It preserves CLI and safety checks, and does not implement
an alternate order, Kill Switch or approval path.
"""
from __future__ import annotations

import runpy
from pathlib import Path


def canonical_guard_script() -> Path:
    destination = Path(__file__).resolve().parent / "disdex_v96_v52_margin_guard_runtime.py"
    if destination.is_symlink() or not destination.is_file():
        raise RuntimeError("CANONICAL_MARGIN_GUARD_RUNTIME_UNAVAILABLE")
    return destination


if __name__ == "__main__":
    # Only the original CLI's main() can execute. This wrapper imports no
    # trading libraries and does not alter argv, mode or systemd credentials.
    runpy.run_path(str(canonical_guard_script()), run_name="__main__")
