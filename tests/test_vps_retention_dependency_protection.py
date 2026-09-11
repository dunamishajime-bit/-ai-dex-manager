import importlib.machinery
import os
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/ops/root/disdex-vps-retention-cleanup"
retention = importlib.machinery.SourceFileLoader("disdex_retention", str(SCRIPT)).load_module()


class RetentionDependencyProtectionTest(unittest.TestCase):
    def test_current_release_dependency_target_is_never_deleted(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            paths = retention.CleanupPaths(
                trading_root=root / "trading",
                shared_root=root / "shared",
                ops_root=root / "ops",
                systemd_backup_root=root / "systemd",
                pm2_log_root=root / "pm2",
            )
            paths.releases_root.mkdir(parents=True)
            releases = []
            now = time.time()
            for index in range(5):
                sha = f"{index + 1:040x}"
                release = paths.releases_root / sha
                release.mkdir()
                (release / ".disdex-release-sha").write_text(sha + "\n", encoding="utf-8")
                (release / "payload").write_text("x", encoding="utf-8")
                stamp = now - (index + 2) * 86400
                os.utime(release, (stamp, stamp))
                releases.append(release)

            current = releases[2]
            dependency = releases[4]
            (dependency / ".venv2/bin").mkdir(parents=True)
            python = dependency / ".venv2/bin/python"
            python.write_text("#!/bin/sh\n", encoding="utf-8")
            python.chmod(0o755)
            (current / ".venv2").symlink_to(dependency / ".venv2")
            paths.current_link.symlink_to(current)

            report = retention.CleanupReport(dry_run=False)
            retention.cleanup_releases(paths, report, now)

            self.assertTrue(dependency.exists(), "dependency release backing current .venv2 must be retained")
            self.assertTrue((current / ".venv2/bin/python").exists(), "current dependency symlink must remain resolvable")


if __name__ == "__main__":
    unittest.main()
