import importlib.machinery
import os
import tempfile
import unittest
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

    def test_conflicting_ui_identity_markers_fail_closed(self):
        with tempfile.TemporaryDirectory() as td:
            release = Path(td) / "ui-current"
            release.mkdir()
            (release / ".disdex-ui-release-sha").write_text("a" * 40 + "\n", encoding="utf-8")
            (release / ".disdex-ui-sha").write_text("b" * 40 + "\n", encoding="utf-8")
            self.assertIsNone(vps_retention.ui_release_sha(release))
            self.assertIsNone(ui_retention.release_sha(release))

    def test_systemd_grants_only_ui_release_root_for_ui_cleanup(self):
        service = SERVICE.read_text(encoding="utf-8")
        self.assertIn("ReadWritePaths=-/home/deploy/disdex-trading/ui-releases", service)


if __name__ == "__main__":
    unittest.main()
