import importlib.machinery
import contextlib
import io
import json
import os
import tempfile
import unittest
from unittest import mock
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/ops/root/disdex-vps-retention-cleanup"
SERVICE = ROOT / "ops/systemd/disdex-vps-retention.service"
UI_SCRIPT = ROOT / "scripts/ops/root/disdex-ui-retention-cleanup"
vps_retention = importlib.machinery.SourceFileLoader("disdex_vps_retention_marker_test", str(SCRIPT)).load_module()
ui_retention = importlib.machinery.SourceFileLoader("disdex_ui_retention_marker_test", str(UI_SCRIPT)).load_module()


class UiRetentionContractTest(unittest.TestCase):
    def test_systemd_reference_blocks_ui_release_deletion(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            release = root / "ui-old"
            release.mkdir()
            (release / ".disdex-ui-sha").write_text("a" * 40 + "\n", encoding="utf-8")
            systemd = root / "systemd"
            systemd.mkdir()
            (systemd / "ui.conf").write_text(
                f"WorkingDirectory={release}\n", encoding="utf-8"
            )

            audit = ui_retention.audit_ui_release_references(
                release,
                systemd_reference_roots=(systemd,),
                symlink_scan_root=root / "deploy",
                process_root=root / "proc",
            )

            self.assertFalse(audit.safe)
            self.assertTrue(audit.references["systemd"])

    def test_symlink_reference_scan_finds_ui_target(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            release = root / "ui-old"
            release.mkdir()
            link_root = root / "deploy"
            link_root.mkdir()
            link = link_root / "current-ui"
            link.symlink_to(release)

            references = ui_retention.find_ui_symlink_references(release, link_root)

            self.assertEqual(references, [f"{link} -> {release}"])

    def test_bulk_symlink_scan_indexes_ui_targets_once(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            release_one = root / "ui-one"
            release_two = root / "ui-two"
            release_one.mkdir()
            release_two.mkdir()
            link_root = root / "deploy"
            link_root.mkdir()
            link_one = link_root / "one"
            link_two = link_root / "two"
            link_one.symlink_to(release_one)
            link_two.symlink_to(release_two)

            indexed = ui_retention.find_ui_symlink_references_for_paths(
                (release_one, release_two), link_root
            )

            self.assertEqual(list(indexed[str(release_one)]), [f"{link_one} -> {release_one}"])
            self.assertEqual(list(indexed[str(release_two)]), [f"{link_two} -> {release_two}"])

    def test_marker_backed_immutable_ui_releases_are_supported(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn(".disdex-ui-release-sha", source)
        self.assertIn("def ui_release_sha", source)
        self.assertIn("def current_ui_release", source)
        self.assertIn("def cleanup_ui_releases", source)
        self.assertIn("cleanup_ui_releases(", source)
        self.assertIn("UI_RELEASE_KEEP_NONCURRENT = 2", source)

    def test_ui_release_identity_comes_from_marker_not_directory_suffix(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn('path.name.startswith("ui-")', source)
        self.assertIn("SHA_RE.fullmatch", source)
        self.assertIn(".disdex-ui-release-sha", source)


    def test_current_ui_sha_marker_is_accepted_by_both_retention_paths(self):
        sha = "a" * 40
        with tempfile.TemporaryDirectory() as td:
            release = Path(td) / "ui-current"
            release.mkdir()
            (release / ".disdex-ui-sha").write_text(sha + "\n", encoding="utf-8")
            self.assertEqual(vps_retention.ui_release_sha(release), sha)
            self.assertEqual(ui_retention.release_sha(release), sha)

    def test_markerless_current_ui_is_resolved_for_protection(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            ui_root = root / "ui-releases"
            release = ui_root / "ui-current-markerless"
            release.mkdir(parents=True)
            paths = vps_retention.CleanupPaths(trading_root=root)
            previous = os.environ.get("DISDEX_UI_ACTIVE_RELEASE")
            os.environ["DISDEX_UI_ACTIVE_RELEASE"] = str(release)
            try:
                self.assertEqual(vps_retention.current_ui_release(paths), release)
            finally:
                if previous is None:
                    os.environ.pop("DISDEX_UI_ACTIVE_RELEASE", None)
                else:
                    os.environ["DISDEX_UI_ACTIVE_RELEASE"] = previous

    def test_unverified_current_ui_path_is_resolved_only_for_protection(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "ui-releases"
            release = root / "ui-current-markerless"
            release.mkdir(parents=True)
            with mock.patch.object(ui_retention, "ROOT", root), mock.patch.object(
                ui_retention.subprocess,
                "check_output",
                return_value=f"{release}\n",
            ):
                resolved = ui_retention.configured_service_directory()
                self.assertEqual(resolved, release)
                self.assertIsNone(ui_retention.release_sha(resolved))

    def test_conflicting_ui_identity_markers_fail_closed(self):
        with tempfile.TemporaryDirectory() as td:
            release = Path(td) / "ui-current"
            release.mkdir()
            (release / ".disdex-ui-release-sha").write_text("a" * 40 + "\n", encoding="utf-8")
            (release / ".disdex-ui-sha").write_text("b" * 40 + "\n", encoding="utf-8")
            self.assertIsNone(vps_retention.ui_release_sha(release))
            self.assertIsNone(ui_retention.release_sha(release))

    def test_exact_standalone_hp_release_marker(self):
        sha = "a" * 40
        with tempfile.TemporaryDirectory() as td:
            release = Path(td) / ("ui-hp-approval-" + sha[:12])
            release.mkdir()
            (release / ".disdex-release-sha").write_text(sha + "\n", encoding="utf-8")
            self.assertEqual(vps_retention.ui_release_sha(release), sha)
            self.assertEqual(ui_retention.release_sha(release), sha)

    def test_standalone_hp_release_marker_rejects_wrong_directory(self):
        sha = "a" * 40
        with tempfile.TemporaryDirectory() as td:
            for name in ("ui-hp-approval-" + "b" * 12, "ui-unrelated"):
                release = Path(td) / name
                release.mkdir()
                (release / ".disdex-release-sha").write_text(sha + "\n", encoding="utf-8")
                self.assertIsNone(vps_retention.ui_release_sha(release))
                self.assertIsNone(ui_retention.release_sha(release))

    def test_standalone_hp_release_marker_rejects_conflict_or_symlink(self):
        sha = "a" * 40
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            release = root / ("ui-hp-approval-" + sha[:12])
            release.mkdir()
            marker = release / ".disdex-release-sha"
            marker.write_text(sha + "\n", encoding="utf-8")
            legacy = release / ".disdex-ui-sha"
            legacy.write_text("b" * 40 + "\n", encoding="utf-8")
            self.assertIsNone(vps_retention.ui_release_sha(release))
            self.assertIsNone(ui_retention.release_sha(release))
            legacy.unlink()
            marker.unlink()
            external = root / "marker"
            external.write_text(sha + "\n", encoding="utf-8")
            marker.symlink_to(external)
            self.assertIsNone(vps_retention.ui_release_sha(release))
            self.assertIsNone(ui_retention.release_sha(release))

    def test_dryrun_and_apply_report_distinct_actual_deletions(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            releases = root / "ui-releases"
            releases.mkdir()
            paths = []
            for index in range(4):
                p = releases / ("ui-" + str(index))
                p.mkdir()
                (p / ".disdex-ui-sha").write_text("a" * 40 + "\n")
                (p / "build.txt").write_text("fixture")
                os.utime(p, (1000 + index, 1000 + index))
                paths.append(p)
            current = paths[-1]
            oldest = paths[0]
            audit = ui_retention.ReferenceAudit(True, {}, ())
            with mock.patch.object(ui_retention, "ROOT", releases), mock.patch.object(
                ui_retention, "LOCK", root / "retention.lock"
            ), mock.patch.object(
                ui_retention, "configured_service_directory", return_value=current
            ), mock.patch.object(
                ui_retention, "find_ui_symlink_references_for_paths", return_value={}
            ), mock.patch.object(
                ui_retention, "audit_ui_release_references", return_value=audit
            ):
                def report(mode):
                    output = io.StringIO()
                    with mock.patch("sys.argv", ["retention", mode]), contextlib.redirect_stdout(output):
                        self.assertEqual(ui_retention.main(), 0)
                    return json.loads(output.getvalue())

                dry = report("--dry-run")
                self.assertTrue(oldest.exists())
                self.assertEqual(dry["deletedReleases"], [])
                self.assertEqual(len(dry["deleteCandidates"]), 1)
                self.assertGreater(dry["estimatedCandidateBytes"], 0)
                applied = report("--apply")
                self.assertFalse(oldest.exists())
                self.assertTrue(current.exists())
                self.assertEqual(applied["deletedReleases"], [str(oldest)])
                self.assertEqual(applied["deleteCandidates"], dry["deleteCandidates"])
                self.assertEqual(applied["estimatedCandidateBytes"], dry["estimatedCandidateBytes"])
                self.assertIn("filesystemFreeBytesAfter", applied)

    def test_systemd_grants_only_ui_release_root_for_ui_cleanup(self):
        service = SERVICE.read_text(encoding="utf-8")
        self.assertIn("ReadWritePaths=-/home/deploy/disdex-trading/ui-releases", service)


if __name__ == "__main__":
    unittest.main()
