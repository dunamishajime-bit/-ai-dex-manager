from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from disdex_v13d_v11eq_stock_live_engine import AsterClient, ASTER_SYMBOL, finite

ACKNOWLEDGEMENT = "I_APPROVE_DISDEX_V96_V52_FIXED_5X_CROSS_MARGIN"
REQUIRED_LEVERAGE = 5
CRYPTO_SYMBOLS = ("BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "PENGUUSDT")
STOCK_SYMBOLS = tuple(ASTER_SYMBOL.values())
MANAGED_SYMBOLS = CRYPTO_SYMBOLS + STOCK_SYMBOLS


def _validate_sha(value: str) -> str:
    sha = value.strip().lower()
    if len(sha) != 40 or any(char not in "0123456789abcdef" for char in sha):
        raise RuntimeError("Account-risk preparation requires an exact runtime SHA")
    return sha


def _release_diagnostics(cwd: Path, expected: Path) -> str:
    def resolved(path: Path) -> str:
        try:
            return str(path.resolve(strict=False))
        except OSError as error:
            return f"<resolve-error:{error}>"

    return (
        f"cwd={cwd}; cwdReal={resolved(cwd)}; "
        f"expected={expected}; expectedReal={resolved(expected)}; "
        f"expectedExists={expected.exists()}; expectedIsDir={expected.is_dir()}; "
        f"expectedIsSymlink={expected.is_symlink()}"
    )


def _validate_release_identity(sha: str, cwd: Path, expected: Path) -> None:
    if not expected.exists() or not expected.is_dir():
        raise RuntimeError(
            "Exact immutable release directory is missing: "
            + _release_diagnostics(cwd, expected)
        )
    if expected.is_symlink():
        raise RuntimeError(
            "Exact immutable release directory must not be a symlink: "
            + _release_diagnostics(cwd, expected)
        )

    try:
        same_release = os.path.samefile(cwd, expected)
    except OSError as error:
        raise RuntimeError(
            "Account-risk preparation could not verify the immutable release identity: "
            + _release_diagnostics(cwd, expected)
            + f"; samefileError={error}"
        ) from error

    if not same_release:
        raise RuntimeError(
            "Account-risk preparation must run from the exact immutable release: "
            + _release_diagnostics(cwd, expected)
        )

    marker = expected / ".disdex-release-sha"
    if not marker.is_file() or marker.is_symlink():
        raise RuntimeError(
            f"Immutable release SHA marker is missing, non-regular, or symlinked: marker={marker}"
        )
    marker_sha = marker.read_text(encoding="utf-8").strip().lower()
    if marker_sha != sha:
        raise RuntimeError(
            f"Immutable release SHA marker mismatch: expected={sha}; actual={marker_sha}"
        )


def require_exact_release() -> str:
    sha = _validate_sha(str(os.getenv("DISDEX_V96_RUNTIME_COMMIT_SHA") or ""))
    expected = Path(f"/home/deploy/disdex-trading/releases/{sha}")
    cwd = Path.cwd()
    _validate_release_identity(sha, cwd, expected)
    return sha


def _expect_failure(label: str, callback) -> None:
    try:
        callback()
    except RuntimeError:
        return
    raise AssertionError(f"Expected account-risk exact-release rejection: {label}")


def run_self_test() -> int:
    sha = "a" * 40
    with tempfile.TemporaryDirectory(prefix="disdex-account-risk-release-") as temporary:
        root = Path(temporary)
        releases = root / "releases"
        expected = releases / sha
        expected.mkdir(parents=True)
        marker = expected / ".disdex-release-sha"
        marker.write_text(f"{sha}\n", encoding="utf-8")

        _validate_release_identity(sha, expected, expected)

        alias_root = root / "release-alias"
        alias_root.symlink_to(releases, target_is_directory=True)
        _validate_release_identity(sha, alias_root / sha, expected)

        other = releases / ("b" * 40)
        other.mkdir()
        (other / ".disdex-release-sha").write_text(f"{sha}\n", encoding="utf-8")
        _expect_failure(
            "different directory",
            lambda: _validate_release_identity(sha, other, expected),
        )

        marker.write_text(f"{'c' * 40}\n", encoding="utf-8")
        _expect_failure(
            "marker mismatch",
            lambda: _validate_release_identity(sha, expected, expected),
        )
        marker.write_text(f"{sha}\n", encoding="utf-8")

        symlink_expected = root / "symlink-release"
        symlink_expected.symlink_to(expected, target_is_directory=True)
        _expect_failure(
            "symlink expected directory",
            lambda: _validate_release_identity(sha, expected, symlink_expected),
        )

        _expect_failure("invalid SHA", lambda: _validate_sha("not-a-sha"))

    print("V96/V52 account-risk exact-release identity self-test: PASS")
    return 0


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
        arguments = sys.argv[1:]
        if arguments:
            if arguments == ["--self-test"]:
                raise SystemExit(run_self_test())
            raise RuntimeError(f"Unsupported account-risk preparation arguments: {arguments}")
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
