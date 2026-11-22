#!/usr/bin/env python3
"""Read-only STABLE4 candidate source guard. Does not grant order authority."""
from __future__ import annotations

import hashlib
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "docs/production/stable4-exit-safety-candidate-source-manifest-20261123.json"


def assert_pre_live_source(root: pathlib.Path = ROOT, manifest: dict | None = None) -> dict:
    info = manifest if manifest is not None else json.loads(
        (root / "docs/production/stable4-exit-safety-candidate-source-manifest-20261123.json").read_text(encoding="utf8"))
    if info.get("liveOrderAuthorizationGranted") is not False:
        raise AssertionError("STABLE4_LIVE_ORDER_AUTHORITY_MUST_REMAIN_FALSE")
    if info.get("requiresCodexFinalOwnerCutover") is not True:
        raise AssertionError("STABLE4_OWNER_CUTOVER_MUST_BE_SEPARATE")
    if info.get("stable4EconomicParityVersusResearchBtFullyCertified") is not False:
        raise AssertionError("STABLE4_ECONOMIC_PARITY_UNPROVEN_CANNOT_BE_CERTIFIED")
    source_hashes = info["expectedSourceNormalizedSha256"]
    if len(source_hashes) < 15:
        raise AssertionError("STABLE4_SOURCE_MANIFEST_INCOMPLETE")
    source = {}
    for rel, expected in source_hashes.items():
        if pathlib.PurePosixPath(rel).is_absolute() or ".." in pathlib.PurePosixPath(rel).parts:
            raise AssertionError("STABLE4_SOURCE_PATH_UNTRUSTED")
        p = (root / rel).resolve()
        if not p.is_file() or not p.is_relative_to(root.resolve()):
            raise AssertionError("STABLE4_SOURCE_FILE_MISSING:" + rel)
        normalized = p.read_bytes().replace(b"\r\n", b"\n")
        if hashlib.sha256(normalized).hexdigest() != expected:
            raise AssertionError("STABLE4_PINNED_SOURCE_CHANGED:" + rel)
        source[rel] = normalized.decode("utf-8-sig")

    assert_tokens = {
        "lib/v12-v4-runner-engine.ts": (
            "hasFreshV4SharedAccountLedger", "attestV4CompletedExitMissingStop",
            "V4_SIGNED_ACCOUNT_MAX_AGE_MS", "reconcileEntriesAndProtection"),
        "lib/v12-v4-venue-exit.ts": ("reconcileV4ExternalFlatClose",),
        "lib/v12-v4-stop-retirement.ts": ("attestV4CompletedExitMissingStop",),
        "lib/disdex-shared-kill-switch.ts": ("SharedKillSwitchActiveError",),
        "scripts/v12-v4-production-runner.ts": ("writeRunnerTickHeartbeat",),
        "lib/pengu-dual-ls-v2-portfolio-runner.ts": (
            "penguForeignOrderConflictsWithAction", "state.position && conflictingSameSymbolOrder",
            "if (!state.position && nonQuality102OpenOrders.length > 0)"),
        "lib/disdex-quality102-causal-v1-runner.ts": (
            "Q102 existing-position H1 history unavailable",
            "Q102_ENTRY_HISTORY_UNAVAILABLE", "history\n                    ? await this.updateAdoptedPolicyState"),
        "scripts/disdex_v52_aster_only_legacy_engine.py": (
            "strategy_daily_loss_held = self.enforce_daily_loss()",
            "v52-strategy-daily-loss-exit-management-continues",
            "self.manage_positions("),
        "config/v12V4AdoptionRiskPolicy.ts": ("V12_V4_MAXIMUM_DRAWDOWN = 0.21",),
        "config/integratedProductionRiskPolicy.ts": (
            "cryptoGrossCap: 3.0", "totalGrossCap: 4.25", "cryptoDailyLossPct: 7.5"),
        "config/sharedCryptoRiskPolicy.ts": ("SHARED_CRYPTO_DAILY_LOSS_PCT = 7.5",),
    }
    for rel, markers in assert_tokens.items():
        txt = source.get(rel)
        if txt is None:
            raise AssertionError("STABLE4_SOURCE_REQUIRED_NOT_TRACKED:" + rel)
        for marker in markers:
            if marker not in txt:
                raise AssertionError("STABLE4_PROTECTION_WIRING_MISSING:" + rel + ":" + marker)
    return {
        "sourceFilesHashVerified": len(source),
        "V4PinnedExitProtection": "PASS",
        "V52ExistingExitPreserved": "PASS",
        "PenguExistingExitPreserved": "PASS",
        "Q102ExistingExitPreserved": "PASS",
        "codeReadyForReview": True,
        "economicBtRuntimeParity": "NOT_CERTIFIED",
        "vpsProductionDeploy": "NOT_PERFORMED",
        "liveOrderAuthorization": False,
        "ownerCutoverRequired": True,
    }


def main() -> int:
    try:
        result = assert_pre_live_source()
    except Exception as error:
        print("STABLE4_SOURCE_PREP_FAIL_CLOSED:" + str(error), file=sys.stderr)
        return 2
    print("STABLE4_READ_ONLY_SOURCE_SAFETY_READY_FOR_CODEX_REVIEW")
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
