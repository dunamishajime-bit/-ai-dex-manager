from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

from disdex_v13d_v11eq_stock_live_engine import AsterClient, ASTER_SYMBOL, finite

ACKNOWLEDGEMENT = "I_APPROVE_DISDEX_V96_V52_FIXED_5X_CROSS_MARGIN"
REQUIRED_LEVERAGE = 5
CRYPTO_SYMBOLS = ("BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "PENGUUSDT")
STOCK_SYMBOLS = tuple(ASTER_SYMBOL.values())
MANAGED_SYMBOLS = CRYPTO_SYMBOLS + STOCK_SYMBOLS


def require_exact_release() -> str:
    sha = str(os.getenv("DISDEX_V96_RUNTIME_COMMIT_SHA") or "").strip().lower()
    if len(sha) != 40 or any(char not in "0123456789abcdef" for char in sha):
        raise RuntimeError("Account-risk preparation requires an exact runtime SHA")
    expected = Path(f"/home/deploy/disdex-trading/releases/{sha}")
    cwd = Path.cwd().resolve()
    marker = cwd / ".disdex-release-sha"
    if cwd != expected:
        raise RuntimeError("Account-risk preparation must run from the exact immutable release")
    if not marker.is_file() or marker.is_symlink() or marker.read_text(encoding="utf-8").strip() != sha:
        raise RuntimeError("Immutable release SHA marker mismatch")
    return sha


def require_service_inactive() -> None:
    state = subprocess.run(
        ["systemctl", "is-active", "disdex-v96-v52-live.service"],
        check=False,
        capture_output=True,
        text=True,
    ).stdout.strip()
    pid = subprocess.run(
        ["systemctl", "show", "disdex-v96-v52-live.service", "--property", "MainPID", "--value"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if state not in {"inactive", "failed"} or pid != "0":
        raise RuntimeError(f"LIVE service must be inactive with MainPID 0, got state={state}, pid={pid}")


def normalized_margin_type(row: dict) -> str:
    raw = str(row.get("marginType") or "").strip().lower()
    if raw in {"cross", "crossed"}:
        return "cross"
    if raw in {"isolated", "isolate"}:
        return "isolated"
    if row.get("isolated") is False:
        return "cross"
    if row.get("isolated") is True:
        return "isolated"
    return "unknown"


def verify_configuration(client: AsterClient) -> dict:
    rows = client.positions()
    by_symbol = {str(row.get("symbol") or "").upper(): row for row in rows}
    result = {}
    for symbol in MANAGED_SYMBOLS:
        row = by_symbol.get(symbol)
        if row is None:
            raise RuntimeError(f"Aster position-risk row missing after account-risk preparation: {symbol}")
        leverage = int(finite(row.get("leverage")))
        margin_type = normalized_margin_type(row)
        if leverage != REQUIRED_LEVERAGE:
            raise RuntimeError(f"Aster leverage read-back mismatch for {symbol}: {leverage}")
        if margin_type != "cross":
            raise RuntimeError(f"Aster margin-type read-back mismatch for {symbol}: {margin_type}")
        result[symbol] = {"leverage": leverage, "marginType": margin_type}
    return result


def apply_margin_type(client: AsterClient, symbol: str) -> None:
    try:
        client._signed("POST", "/fapi/v1/marginType", {"symbol": symbol, "marginType": "CROSSED"})
    except RuntimeError as error:
        message = str(error)
        if "-4046" not in message and "NO_NEED_TO_CHANGE_MARGIN_TYPE" not in message:
            raise


def apply_leverage(client: AsterClient, symbol: str) -> None:
    try:
        client._signed("POST", "/fapi/v1/leverage", {"symbol": symbol, "leverage": REQUIRED_LEVERAGE})
    except RuntimeError as error:
        message = str(error)
        if "-4028" not in message and "already exist" not in message.lower():
            raise


def main() -> int:
    sha = require_exact_release()
    require_service_inactive()
    acknowledgement = str(os.getenv("DISDEX_V96_V52_ACCOUNT_RISK_ACKNOWLEDGEMENT") or "").strip()
    if acknowledgement != ACKNOWLEDGEMENT:
        raise RuntimeError("Exact account-risk preparation acknowledgement is required")

    client = AsterClient(live=True)
    positions = client.positions()
    active = [
        str(row.get("symbol") or "")
        for row in positions
        if abs(finite(row.get("positionAmt"))) > 1e-12
    ]
    if active:
        raise RuntimeError(f"Account-risk preparation requires all positions flat: {active}")
    open_orders = client.open_orders()
    if open_orders:
        raise RuntimeError(f"Account-risk preparation requires zero open orders: {len(open_orders)}")

    for symbol in MANAGED_SYMBOLS:
        apply_margin_type(client, symbol)
        apply_leverage(client, symbol)

    configuration = verify_configuration(client)
    print(json.dumps({
        "status": "DISDEX_V96_V52_ACCOUNT_RISK_PREPARATION_PASS",
        "runtimeCommitSha": sha,
        "requiredLeverage": REQUIRED_LEVERAGE,
        "requiredMarginType": "cross",
        "managedSymbols": configuration,
        "serviceStarted": False,
        "ordersSent": False,
        "cancelSent": False,
        "positionChangesSent": False,
        "accountConfigurationChanged": True,
    }, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({
            "status": "DISDEX_V96_V52_ACCOUNT_RISK_PREPARATION_FAIL_CLOSED",
            "message": str(error),
            "serviceStarted": False,
            "ordersSent": False,
            "cancelSent": False,
            "positionChangesSent": False,
        }, separators=(",", ":")))
        raise
