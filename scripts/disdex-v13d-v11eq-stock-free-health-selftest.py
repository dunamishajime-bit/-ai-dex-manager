from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import disdex_v13d_v11eq_stock_free_live_engine as free  # noqa: E402


class FakeReference:
    template = "http://127.0.0.1:8797/quote?symbol={symbol}"
    headers = {}
    timeout = 0.1


def main() -> int:
    payload = {
        "provider": "alpaca",
        "feed": "iex",
        "status": "ok",
        "connected": True,
        "lastError": None,
        "lastMessageAt": 1787820000000,
        "symbols": {},
    }
    with patch.dict(os.environ, {"DISDEX_STOCK_REFERENCE_HEALTH_TIMEOUT_MS": "0"}, clear=False):
        with patch.object(free, "regular_us_equity_session", return_value=False):
            with patch.object(free.engine, "http_json", return_value=payload):
                result = free.reference_health(FakeReference())
    assert result["connected"] is True
    assert result["status"] == "ok"
    assert free.is_alpaca_iex_health(result)
    print("Alpaca IEX single-source health self-test: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
