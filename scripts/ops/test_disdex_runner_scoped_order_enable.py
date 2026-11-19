"""Unit tests for the fail-closed Runner-scoped order-enable transaction."""
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest import mock

from scripts.ops.deploy import disdex_runner_scoped_order_enable as gate


SOURCE = "1657e173d250ad58f53e62f7bb0a3428fb405496"
PLAN = "a" * 64
APPROVAL_ID = "5ad3c5a3-0833-4d27-bd05-f057ca434efa"
RUN_ID = "44330000001"
NOW = 1_800_000_000_000


def approval(status="REDEEMED", run_id=RUN_ID):
    return {
        "id": APPROVAL_ID,
        "operation": "PENGU_V8_SCOPED_ORDER_ENABLE",
        "scope": "PENGU_V8",
        "targetSha": SOURCE,
        "planSha256": PLAN,
        "requestActor": "dunamishajime-bit",
        "ordersEnabled": True,
        "status": status,
        "redeemedByRunId": run_id,
        "createdAt": NOW - 20_000,
        "approvedAt": NOW - 10_000,
        "redeemedAt": NOW - 5_000,
        "requestExpiresAt": NOW + 1_000,
    }


def hold():
    return {
        "active": True,
        "action": "HOLD_PROTECTED",
        "scope": "GLOBAL",
        "operator": "disdex-stable4-formal-owner-hold",
        "strategyId": "STABLE4_H48_CUTOVER",
        "reason": "STABLE4_RESEARCH_ROLLOUT:e0e4f1d8f22b62e9410188ef6e590a20e31f760f",
    }


class RunnerScopedOrderEnableTests(unittest.TestCase):
    def test_runner_specs_exclude_hype_and_full_project(self):
        self.assertEqual(set(gate.RUNNER_SPECS), {
            "V12_V4", "PENGU_V8", "QUALITY102_CAUSAL_V1", "V52",
            "FET_BRK48_RESIDUAL", "IDLE_PRIORITY_SHORT",
        })
        for runner, spec in gate.RUNNER_SPECS.items():
            self.assertEqual(spec["scope"], runner)
            self.assertEqual(spec["operation"], runner + "_SCOPED_ORDER_ENABLE")

    def test_exact_redeemed_approval_is_required(self):
        self.assertEqual(
            gate.validate_approval_record(approval(), runner="PENGU_V8",
                                          source_sha=SOURCE, plan_sha256=PLAN,
                                          scope="PENGU_V8", operation="PENGU_V8_SCOPED_ORDER_ENABLE",
                                          approval_id=APPROVAL_ID, run_id=RUN_ID, now_ms=NOW)["id"],
            APPROVAL_ID,
        )
        for diff in ({"scope": "FULL_PROJECT"}, {"ordersEnabled": False}, {"status": "APPROVED"}):
            row = approval()
            row.update(diff)
            with self.assertRaises(ValueError):
                gate.validate_approval_record(row, runner="PENGU_V8", source_sha=SOURCE,
                                              plan_sha256=PLAN, scope="PENGU_V8",
                                              operation="PENGU_V8_SCOPED_ORDER_ENABLE",
                                              approval_id=APPROVAL_ID, run_id=RUN_ID, now_ms=NOW)

    def test_permit_is_runner_bound_and_zero_mutation(self):
        raw = json.dumps(hold(), sort_keys=True, separators=(",", ":")).encode()
        digest = hashlib.sha256(raw).hexdigest()
        row = gate.build_runner_permit(
            approval_record=approval(), runner="PENGU_V8", source_sha=SOURCE,
            plan_sha256=PLAN, scope="PENGU_V8", operation="PENGU_V8_SCOPED_ORDER_ENABLE",
            kill_switch=hold(), kill_switch_sha256=digest, nonce_sha256="c" * 64,
            issued_at=NOW, expires_at=NOW + 86_400_000,
        )
        self.assertEqual(row["runner"], "PENGU_V8")
        self.assertTrue(row["ordersEnabled"])
        self.assertEqual((row["ordersSent"], row["cancelsSent"], row["positionChangesSent"]), (0, 0, 0))
        with self.assertRaises(ValueError):
            gate.validate_runner_permit({**row, "runner": "V52"}, runner="PENGU_V8",
                                        source_sha=SOURCE, plan_sha256=PLAN,
                                        scope="PENGU_V8", operation="PENGU_V8_SCOPED_ORDER_ENABLE",
                                        approval_id=APPROVAL_ID, kill_switch=hold(),
                                        kill_switch_sha256=digest, now_ms=NOW + 1)

    def test_common_kill_switch_overlay_is_scoped_and_preserves_hold(self):
        base = (b'import { readFile } from "node:fs/promises";\n'
                b'export async function assertSharedKillSwitchAllowsNewEntry(env: NodeJS.ProcessEnv = process.env) {\n'
                b'    const state = await readSharedKillSwitch(env);\n'
                b'    if (state.active) throw new Error(`SHARED_KILL_SWITCH_ACTIVE:${state.reason || "UNSPECIFIED"}`);\n'
                b'    return state;\n'
                b'}\n')
        patched = gate.build_common_kill_switch_overlay(
            base, runner="PENGU_V8", permit_module_path="/overlay/runner-order-permit.ts"
        ).decode()
        self.assertIn("hasValidRunnerOrderPermit", patched)
        self.assertIn('runner: "PENGU_V8"', patched)
        self.assertIn('scope: "PENGU_V8"', patched)
        self.assertIn('operation: "PENGU_V8_SCOPED_ORDER_ENABLE"', patched)
        self.assertIn("SHARED_KILL_SWITCH_ACTIVE", patched)

    def test_release_marker_is_normalized_without_content_change(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = os.path.join(temp_dir, ".disdex-release-sha")
            original = b"e0e4f1d8f22b62e9410188ef6e590a20e31f760f\\n"
            with open(path, "wb") as handle:
                handle.write(original)
            os.chmod(path, 0o644)

            gate.normalize_release_marker_permissions(path)

            with open(path, "rb") as handle:
                self.assertEqual(handle.read(), original)
            self.assertEqual(stat.S_IMODE(os.stat(path).st_mode) & 0o222, 0)

    def test_release_directory_normalization_chowns_non_root_directory(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "release"
            path.mkdir()
            os.chmod(path, 0o755)
            fake_stat = mock.Mock(st_mode=stat.S_IFDIR | 0o755, st_uid=1000, st_gid=1000)
            with mock.patch.object(gate.Path, "lstat", return_value=fake_stat):
                with mock.patch.object(gate.os, "chown") as chown:
                    gate.normalize_release_directory_permissions(path)

            if os.name != "nt":
                chown.assert_called_once_with(path, 0, 0)
            self.assertEqual(stat.S_IMODE(os.stat(path).st_mode) & 0o222, 0)

    def test_release_marker_normalization_chowns_non_root_marker(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = os.path.join(temp_dir, ".disdex-release-sha")
            original = b"e0e4f1d8f22b62e9410188ef6e590a20e31f760f\\n"
            with open(path, "wb") as handle:
                handle.write(original)
            os.chmod(path, 0o644)

            fake_stat = mock.Mock(st_mode=stat.S_IFREG | 0o644, st_uid=1000, st_gid=1000)
            with mock.patch.object(gate.Path, "lstat", return_value=fake_stat):
                with mock.patch.object(gate.os, "chown") as chown:
                    gate.normalize_release_marker_permissions(path)

            if os.name != "nt":
                chown.assert_called_once_with(Path(path), 0, 0)
            with open(path, "rb") as handle:
                self.assertEqual(handle.read(), original)

    def test_candidate_common_module_is_normalized_read_only_without_content_change(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = os.path.join(temp_dir, "disdex-shared-kill-switch.ts")
            original = b"export const unchanged = true;\n"
            with open(path, "wb") as handle:
                handle.write(original)
            os.chmod(path, 0o644)

            gate.normalize_common_module_permissions(path)

            with open(path, "rb") as handle:
                self.assertEqual(handle.read(), original)
            self.assertEqual(stat.S_IMODE(os.stat(path).st_mode) & 0o222, 0)


if __name__ == "__main__":
    unittest.main()
