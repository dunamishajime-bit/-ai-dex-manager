"""Throttled execution wrapper for the frozen research metrics fetcher.

Infrastructure-only recovery for archive request throttling. It changes no
schema, date boundary, coverage gate, hourly aggregation rule, or strategy
logic. Fresh OOS remains blocked by the underlying fetcher's URL firewall.
"""
from __future__ import annotations

from pathlib import Path

import research_fetch_binance_usdm_metrics_history as base

# Reduce request pressure and increase retry budget. All scientific/data gates
# remain inside the frozen base fetcher and are intentionally not changed.
base.MAX_WORKERS = 8
base.RETRIES = 6


def main() -> None:
    base.self_test_firewall()
    base.build(Path(base.DEFAULT_ROOT))


if __name__ == "__main__":
    main()
