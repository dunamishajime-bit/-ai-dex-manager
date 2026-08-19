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
CRYPTO_SYMBOLS = (
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "LINKUSDT", "AVAXUSDT",
    "DOGEUSDT", "INJUSDT", "XRPUSDT", "ADAUSDT", "LTCUSDT", "ATOMUSDT",
    "AAVEUSDT", "NEARUSDT", "PENGUUSDT",
)
STOCK_SYMBOLS = tuple(ASTER_SYMBOL.values())
MANAGED_SYMBOLS = CRYPTO_SYMBOLS + STOCK_SYMBOLS
SCRIPT_RELATIVE_PATH = Path("scripts/disdex-v96-v52-prepare-account-risk.py")
RELEASES_ROOT = Path("/home/deploy/disdex-trading/releases")
ASTER_CHANGE_MARGIN_TYPE_PATH = "/fapi/v3/marginType"
ASTER_CHANGE_LEVERAGE_PATH = "/fapi/v3/leverage"


def _validate_sha(value: str) -> str:
    sha = value.strip().lower()
    if len(sha) != 40 or any(char not in "0123456789abcdef" for char in sha):
        raise RuntimeError("Account-risk preparation requires an exact runtime SHA")
    return sha


def _safe_resolve(path: Path) -> str:
    try:
        return str(path.resolve(strict=False))
    except OSError as error:
        return f"<resolve-error:{error}>"


def _release_diagnostics(cwd: Path, expected: Path, executed_script: Path) -> str:
    expected_script = expected / SCRIPT_RELATIVE_PATH
    return (
        f"cwd={cwd}; cwdReal={_safe_resolve(cwd)}; "
        f"expected={expected}; expectedReal={_safe_resolve(expected)}; "
        f"expectedExists={expected.exists()}; expectedIsDir={expected.is_dir()}; "
        f"expectedIsSymlink={expected.is_symlink()}; "
        f"executedScript={executed_script}; executedScriptReal={_safe_resolve(executed_script)}; "
        f"expectedScript={expected_script}; expectedScriptReal={_safe_resolve(expected_script)}"
    )


def _derive_authoritative_release_sha(
    executed_script: Path,
    releases_root: Path,
) -> str:
    try:
        script_real = executed_script.resolve(strict=True)
        root_real = releases_root.resolve(strict=True)
    except OSError as error:
        raise RuntimeError(
            "Account-risk preparation could not resolve immutable release paths: "
            f"executedScript={executed_script}; releasesRoot={releases_root}; error={error}"
        ) from error

    try:
        release_real = script_real.parents[1]
    except IndexError as error:
        raise RuntimeError(
            f"Executed account-risk script has no immutable release parent: {script_real}"
        ) from error

    try:
        parent_matches = os.path.samefile(release_real.parent, root_real)
    except OSError as error:
        raise RuntimeError(
            "Account-risk preparation could not verify the releases root: "
            f"release={release_real}; releasesRoot={root_real}; error={error}"
        ) from error
    if not parent_matches:
        raise RuntimeError(
            "Executed account-risk script is outside the immutable releases root: "
            f"executedScript={script_real}; release={release_real}; releasesRoot={root_real}"
        )

    return _validate_sha(release_real.name)


def _validate_release_identity(
    sha: str,
    cwd: Path,
    expected: Path,
    executed_script: Path,
) -> None:
    diagnostics = _release_diagnostics(cwd, expected, executed_script)
    if not expected.exists() or not expected.is_dir():
        raise RuntimeError(f"Exact immutable release directory is missing: {diagnostics}")
    if expected.is_symlink():
        raise RuntimeError(f"Exact immutable release directory must not be a symlink: {diagnostics}")

    expected_script = expected / SCRIPT_RELATIVE_PATH
    if not expected_script.is_file() or expected_script.is_symlink():
        raise RuntimeError(
            "Expected account-risk script is missing, non-regular, or symlinked: "
            + diagnostics
        )
    if not executed_script.is_file():
        raise RuntimeError("Executed account-risk script is not a regular file: " + diagnostics)

    try:
        same_script = os.path.samefile(executed_script, expected_script)
    except OSError as error:
        raise RuntimeError(
            "Account-risk preparation could not verify executed script identity: "
            + diagnostics
            + f"; samefileError={error}"
        ) from error
    if not same_script:
        raise RuntimeError(
            "Account-risk preparation is not executing the script from the exact immutable release: "
            + diagnostics
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


def require_exact_release() -> tuple[str, str, bool]:
    executed_script = Path(__file__)
    sha = _derive_authoritative_release_sha(executed_script, RELEASES_ROOT)
    expected = RELEASES_ROOT / sha
    _validate_release_identity(sha, Path.cwd(), expected, executed_script)

    environment_sha = str(os.getenv("DISDEX_V96_RUNTIME_COMMIT_SHA") or "").strip().lower()
    environment_matches = environment_sha == sha
    return sha, environment_sha, environment_matches


def _expect_failure(label: str, callback) -> None:
    try:
        callback()
    except RuntimeError:
        return
    raise AssertionError(f"Expected account-risk exact-release rejection: {label}")


def run_self_test() -> int:
    sha = "a" * 40
    stale_sha = "b" * 40
    with tempfile.TemporaryDirectory(prefix="disdex-account-risk-release-") as temporary:
        root = Path(temporary)
        releases = root / "releases"
        expected = releases / sha
        expected_script = expected / SCRIPT_RELATIVE_PATH
        expected_script.parent.mkdir(parents=True)
        expected_script.write_text("# exact release script\n", encoding="utf-8")
        marker = expected / ".disdex-release-sha"
        marker.write_text(f"{sha}\n", encoding="utf-8")

        assert _derive_authoritative_release_sha(expected_script, releases) == sha
        _validate_release_identity(sha, expected, expected, expected_script)

        previous_environment_sha = os.environ.get("DISDEX_V96_RUNTIME_COMMIT_SHA")
        os.environ["DISDEX_V96_RUNTIME_COMMIT_SHA"] = stale_sha
        try:
            assert _derive_authoritative_release_sha(expected_script, releases) == sha
            assert os.environ["DISDEX_V96_RUNTIME_COMMIT_SHA"] != sha
        finally:
            if previous_environment_sha is None:
                os.environ.pop("DISDEX_V96_RUNTIME_COMMIT_SHA", None)
            else:
                os.environ["DISDEX_V96_RUNTIME_COMMIT_SHA"] = previous_environment_sha

        alias_root = root / "release-alias"
        alias_root.symlink_to(releases, target_is_directory=True)
        _validate_release_identity(
            sha,
            alias_root / sha,
            expected,
            alias_root / sha / SCRIPT_RELATIVE_PATH,
        )

        unrelated_cwd = root / "unrelated-working-directory"
        unrelated_cwd.mkdir()
        _validate_release_identity(sha, unrelated_cwd, expected, expected_script)

        foreign_root = root / "foreign-releases"
        foreign_script = foreign_root / sha / SCRIPT_RELATIVE_PATH
        foreign_script.parent.mkdir(parents=True)
        foreign_script.write_text("# foreign script\n", encoding="utf-8")
        _expect_failure(
            "outside releases root",
            lambda: _derive_authoritative_release_sha(foreign_script, releases),
        )
        _expect_failure(
            "foreign executed script",
            lambda: _validate_release_identity(sha, expected, expected, foreign_script),
        )

        marker.write_text(f"{'c' * 40}\n", encoding="utf-8")
        _expect_failure(
            "marker mismatch",
            lambda: _validate_release_identity(sha, expected, expected, expected_script),
        )
        marker.write_text(f"{sha}\n", encoding="utf-8")

        symlink_expected = root / "symlink-release"
        symlink_expected.symlink_to(expected, target_is_directory=True)
        _expect_failure(
            "symlink expected directory",
            lambda: _validate_release_identity(
                sha,
                expected,
                symlink_expected,
                expected_script,
            ),
        )

        _expect_failure("invalid SHA", lambda: _validate_sha("not-a-sha"))

    assert ASTER_CHANGE_MARGIN_TYPE_PATH == "/fapi/v3/marginType"
    assert ASTER_CHANGE_LEVERAGE_PATH == "/fapi/v3/leverage"
    assert len(CRYPTO_SYMBOLS) == 15
    assert "LINKUSDT" in CRYPTO_SYMBOLS and "NEARUSDT" in CRYPTO_SYMBOLS and "PENGUUSDT" in CRYPTO_SYMBOLS
    print("V96/V52 account-risk immutable-release authority self-test: PASS")
    print("asterAccountRiskApiVersion=v3")
    print("staleEnvironmentRuntimeShaIgnored=true")
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
        client._signed(
            "POST",
            ASTER_CHANGE_MARGIN_TYPE_PATH,
            {"symbol": symbol, "marginType": "CROSSED"},
        )
    except RuntimeError as error:
        message = str(error)
        if "-4046" not in message and "NO_NEED_TO_CHANGE_MARGIN_TYPE" not in message:
            raise


def apply_leverage(client: AsterClient, symbol: str) -> None:
    try:
        client._signed(
            "POST",
            ASTER_CHANGE_LEVERAGE_PATH,
            {"symbol": symbol, "leverage": REQUIRED_LEVERAGE},
        )
    except RuntimeError as error:
        message = str(error)
        if "-4028" not in message and "already exist" not in message.lower():
            raise


def main() -> int:
    sha, environment_sha, environment_matches = require_exact_release()
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
        "runtimeShaSource": "executedImmutableRelease",
        "environmentRuntimeSha": environment_sha or None,
        "environmentRuntimeShaMatched": environment_matches,
        "staleEnvironmentRuntimeShaIgnored": bool(environment_sha and not environment_matches),
        "asterAccountRiskApiVersion": "v3",
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
