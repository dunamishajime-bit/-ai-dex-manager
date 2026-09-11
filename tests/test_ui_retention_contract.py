import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/ops/root/disdex-vps-retention-cleanup"
SERVICE = ROOT / "ops/systemd/disdex-vps-retention.service"


class UiRetentionContractTest(unittest.TestCase):
    def test_marker_backed_immutable_ui_releases_are_supported(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn(".disdex-ui-release-sha", source)
        self.assertIn("def ui_release_sha", source)
        self.assertIn("def current_ui_release", source)
        self.assertIn("def cleanup_ui_releases", source)
        self.assertIn("cleanup_ui_releases(paths, report, current_time)", source)
        self.assertIn("UI_RELEASE_KEEP_NONCURRENT = 2", source)

    def test_ui_release_identity_comes_from_marker_not_directory_suffix(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn('path.name.startswith("ui-")', source)
        self.assertIn("SHA_RE.fullmatch", source)
        self.assertIn(".disdex-ui-release-sha", source)

    def test_systemd_grants_only_ui_release_root_for_ui_cleanup(self):
        service = SERVICE.read_text(encoding="utf-8")
        self.assertIn("ReadWritePaths=-/home/deploy/disdex-trading/ui-releases", service)


if __name__ == "__main__":
    unittest.main()
