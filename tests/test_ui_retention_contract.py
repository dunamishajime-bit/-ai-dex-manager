import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/ops/root/disdex-vps-retention-cleanup"
SERVICE = ROOT / "ops/systemd/disdex-vps-retention.service"


class UiRetentionContractTest(unittest.TestCase):
    def test_prefixed_full_sha_ui_releases_are_supported(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn('UI_RELEASE_RE = re.compile(r"^ui-runtime-data-([0-9a-f]{40})$")', source)
        self.assertIn("def current_ui_release", source)
        self.assertIn("def cleanup_ui_releases", source)
        self.assertIn("cleanup_ui_releases(paths, report, current_time)", source)
        self.assertIn("UI_RELEASE_KEEP_NONCURRENT = 2", source)

    def test_active_ui_and_unknown_legacy_names_fail_safe(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn('protected: set[Path] = {current}', source)
        pattern = re.compile(r"^ui-runtime-data-([0-9a-f]{40})$")
        self.assertTrue(pattern.fullmatch("ui-runtime-data-" + "a" * 40))
        self.assertFalse(pattern.fullmatch("ui-hp-live-status-54704e1b"))

    def test_systemd_grants_only_ui_release_root_for_ui_cleanup(self):
        service = SERVICE.read_text(encoding="utf-8")
        self.assertIn("ReadWritePaths=-/home/deploy/disdex-trading/ui-releases", service)


if __name__ == "__main__":
    unittest.main()
