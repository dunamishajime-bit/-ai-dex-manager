"""STABLE4 DD30 source-only release integrity gate. Never redeems or enables orders."""
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
MANIFEST = ROOT / "docs/production/STABLE4_DD30_INTEGRATED_SOURCE_MANIFEST_20261123.json"
REQUIRED_TOKENS = {
    "config/v12V4AdoptionRiskPolicy.ts": ["V12_V4_MAXIMUM_DRAWDOWN = 0.30"],
    "config/integratedProductionRiskPolicy.ts": ["cryptoGrossCap: 3.0", "totalGrossCap: 4.25"],
    "config/v52V50Runtime.json": ['"stockAggregateGross": 4.0', '"slotGross": 2.0'],
    "config/hypeTrendLongPolicy.ts": ["maximumGross: 1.5"],
    "config/q102FamilySideGross.json": ['"HIGH_VOL"', '"PB"', '"MR"', '"BRK"'],
    "lib/v12-v4-shared-reservations.ts": [
        "V12_V4_MAXIMUM_DRAWDOWN", "V4_SHARED_RESERVATION_HOLD"],
    "lib/aster-v3-client.ts": ["AsterUserTradeRow", "AsterIncomeRow", "getUserTrades"],
    "lib/direct-trade-executor.ts": ["requireVenueMargin5xCross", "prepareVenueMargin5xCross"],
    "lib/disdex-v96-live-risk-controls.ts": ["formalStable4Hold", "oldV96Flatten"],
    "lib/disdex-v96-operator-override-audit.ts": ["V96_OPERATOR_OVERRIDE_EXPIRY_REQUIRED"],
    "lib/v12-v4-runner-engine.ts": [
        "attestV4CompletedExitMissingStop", "reconcileEntriesAndProtection"],
    "lib/v12-v4-venue-exit.ts": ["reconcileV4ExternalFlatClose"],
    "lib/pengu-dual-ls-v2-portfolio-runner.ts": ["penguForeignOrderConflictsWithAction"],
    "lib/disdex-quality102-causal-v1-runner.ts": ["Q102 existing-position H1 history unavailable"],
    "scripts/disdex_v52_aster_only_legacy_engine.py": [
        "strategy_daily_loss_held = self.enforce_daily_loss()",
        "self._refresh_v52_daily_flatten_intent()",
        "self._finish_v52_daily_flatten()"],
    "scripts/disdex_v52_daily_loss.py": [
        "update_v52_strategy_daily_flatten", "complete_v52_strategy_daily_flatten",
        'trade.get("exitAt")'],
    "lib/disdex-quality102-causal-v4-signal.ts": [
        "evaluateQ102HighVolD126",
        'requestedGross: quality102GrossForFamily("HIGH_VOL", legacy.side)'],
    "lib/disdex-quality102-highvol-d126.ts": [
        '"LONG_OVERRIDE"', '"KEEP_SHORT"', '"DATA_INVALID"'],
    "lib/hype-h48-native-stop8-coordinator.ts": [
        "prepareH48Stop8Entry", 'tradingAuthorization:false'],
    "lib/hype-h48-stop8-root-authority.ts": [
        "H48_STOP8_ROOT_BUNDLE_SCHEMA", "H48_STOP8_ROOT_GRANT_INVALID"],
    "scripts/ops/deploy/disdex_h48_stop8_formal_issue.py": [
        'POLICY = "H48_R4_RESIDENT_STOP8"', "OWNER_VERIFIER"],
    "lib/stable4-dd30-owner-hard-gross-candidate.ts": [
        "OWNER_STABLE4_GROSS_HARD_CAP_CANDIDATE", "tradingAuthorization:false"],
    "scripts/disdex_v96_v52_margin_guard_runtime.py": ["SerializedMarginGuard"],
    "scripts/disdex_v12_v52_margin_guard_runtime.py": [
        "disdex_v96_v52_margin_guard_runtime.py", "runpy.run_path"],
    "scripts/ops/root/disdex-v4-resident-stop-crosscheck.py": [
        "load_v4_pin", '"/etc/disdex/runner-pins.json"', "V4_ROOT_PIN_FILE_OWNER_INVALID"],
    "scripts/ops/deploy/disdex_owner_approval.py": ["def verify("],
    "lib/owner-goal-approval.ts": ["assertOwnerGoalCandidate", "GOAL_RELEASE_PLAN_SCHEMA"],
    "lib/server/owner-goal-attestation.ts": ["verifyOwnerGoalRelease"],
    ".github/workflows/disdex-owner-goal-candidate-ci.yml": ["candidate-goal-contract"],
    "app/api/system/deploy-approval/route.ts": ["publish_goal"],
}
STOP_ROOT = "scripts/ops/root/disdex-v4-resident-stop-crosscheck.py"
FORMAL_OLD_ROOT = "scripts/ops/deploy/disdex_stable4_safety_repair_cutover.py"
OLD_TARGET = "c7310d34ba1b6de07071d8883a2ed0de8dcce2a7"


def normalized_digest(data: bytes) -> str:
    return hashlib.sha256(data.replace(b"\r\n", b"\n")).hexdigest()


def verify(root: pathlib.Path = ROOT, manifest: dict | None = None) -> dict:
    root = root.resolve()
    data = manifest if manifest is not None else json.loads(
        (root / "docs/production/STABLE4_DD30_INTEGRATED_SOURCE_MANIFEST_20261123.json").read_text(encoding="utf-8"))
    if data.get("schema") != "disdex-stable4-dd30-integrated-source/v1":
        raise AssertionError("INTEGRATED_MANIFEST_SCHEMA_INVALID")
    if data.get("liveOrderAuthority") is not False or data.get("productionInstalled") is not False:
        raise AssertionError("UNVERIFIED_LIVE_AUTHORITY_FORBIDDEN")
    if data.get("ownerApprovalVerified") is not False or data.get("formalCutoverComplete") is not False:
        raise AssertionError("OLD_OWNER_APPROVAL_CANNOT_BE_REUSED")
    if data.get("v4DdEntryHold") != 0.30 or data.get("portfolioDrawdownGuaranteedBelow30") is not False:
        raise AssertionError("DD30_SCOPE_INVALID")
    expected = data.get("sourceSha256") or {}
    if set(expected) != set(REQUIRED_TOKENS):
        raise AssertionError("INTEGRATED_SOURCE_LIST_INCOMPLETE")
    contents = {}
    for rel, digest in expected.items():
        parts = pathlib.PurePosixPath(rel)
        if parts.is_absolute() or ".." in parts.parts:
            raise AssertionError("UNSAFE_SOURCE_PATH")
        path = root / rel
        if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(root):
            raise AssertionError("SOURCE_MISSING_OR_UNSAFE:" + rel)
        value = path.read_bytes()
        if normalized_digest(value) != digest:
            raise AssertionError("INTEGRATED_SOURCE_SHA_MISMATCH:" + rel)
        contents[rel] = value.decode("utf-8-sig")
    for rel, tokens in REQUIRED_TOKENS.items():
        for token in tokens:
            if token not in contents[rel]:
                raise AssertionError("INTEGRATED_SOURCE_PROTECTION_NOT_CONNECTED:" + rel)
    if "53a0be396719f0284af4e11b35c66a4ac7d58f79" in contents[STOP_ROOT]:
        raise AssertionError("STALE_V4_DIAGNOSTIC_PIN_NOT_REMOVED")
    # Existing master Root cutover is strictly tied to old c731 and its old
    # approval. We keep that immutable safety workflow untouched.
    old_root = (root / FORMAL_OLD_ROOT).read_text(encoding="utf-8")
    if OLD_TARGET not in old_root:
        raise AssertionError("OLD_FORMAL_CUTOVER_UNEXPECTED_CHANGE")
    if data.get("oldC731FormalCutoverMayBeUsed") is not False:
        raise AssertionError("OLD_PLAN_MUST_REMAIN_BLOCKED")
    return {
        "integratedFilesVerified": len(contents),
        "ownerGoalApprovalCode": "PRESERVED",
        "v4Dd30EntryHold": "PASS",
        "v4StopDiagnosticDynamicPin": "PASS",
        "marginGuardExpectedEntrypointPresent": "PASS",
        "v52PenguQ102ProtectedExitSources": "PASS",
        "oldC731Cutover": "BLOCKED_REQUIRES_NEW_EXACT_SHA_GOAL_PLAN",
        "productionInstalled": False,
        "liveOrderAuthorization": False,
    }


def main() -> int:
    try:
        result = verify()
    except Exception as exc:
        print("STABLE4_DD30_INTEGRATED_SOURCE_BLOCKED:" + str(exc), file=sys.stderr)
        return 2
    print("STABLE4_DD30_INTEGRATED_SOURCE_OFFLINE_PASS")
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
