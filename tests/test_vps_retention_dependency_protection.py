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
    def test_systemd_reference_makes_release_unverified_protected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            paths = retention.CleanupPaths(
                trading_root=root / "trading",
                shared_root=root / "shared",
                ops_root=root / "ops",
                systemd_backup_root=root / "systemd-backup",
                pm2_log_root=root / "pm2",
                systemd_reference_roots=(root / "etc-systemd",),
                symlink_scan_root=root / "deploy",
                process_root=root / "proc",
                state_reference_roots=(root / "state",),
            )
            release = paths.releases_root / ("a" * 40)
            release.mkdir(parents=True)
            (release / ".disdex-release-sha").write_text("a" * 40 + "\n", encoding="utf-8")
            paths.systemd_reference_roots[0].mkdir(parents=True)
            (paths.systemd_reference_roots[0] / "stale-unit.conf").write_text(
                f"WorkingDirectory={release}\n", encoding="utf-8"
            )

            audit = retention.audit_release_references(release, paths)

            self.assertFalse(audit.safe)
            self.assertTrue(audit.references["systemd"])

    def test_open_process_fd_makes_release_unverified_protected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            paths = retention.CleanupPaths(
                trading_root=root / "trading",
                shared_root=root / "shared",
                ops_root=root / "ops",
                systemd_backup_root=root / "systemd-backup",
                pm2_log_root=root / "pm2",
                systemd_reference_roots=(root / "etc-systemd",),
                symlink_scan_root=root / "deploy",
                process_root=root / "proc",
                state_reference_roots=(root / "state",),
            )
            release = paths.releases_root / ("b" * 40)
            release.mkdir(parents=True)
            (release / ".disdex-release-sha").write_text("b" * 40 + "\n", encoding="utf-8")
            (release / "open.txt").write_text("open", encoding="utf-8")
            fd_dir = paths.process_root / "123" / "fd"
            fd_dir.mkdir(parents=True)
            (fd_dir / "3").symlink_to(release / "open.txt")

            audit = retention.audit_release_references(release, paths)

            self.assertFalse(audit.safe)
            self.assertTrue(audit.references["process"])

    def test_symlink_reference_scan_finds_target_without_recursive_python_walk(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            release = root / ("c" * 40)
            release.mkdir()
            link_root = root / "deploy"
            link_root.mkdir()
            link = link_root / "current"
            link.symlink_to(release)

            references = retention.find_symlink_references(release, link_root)

            self.assertEqual(references, [f"{link} -> {release}"])

    def test_current_release_dependency_target_is_never_deleted(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            paths = retention.CleanupPaths(
                trading_root=root / "trading",
                shared_root=root / "shared",
                ops_root=root / "ops",
                systemd_backup_root=root / "systemd",
                pm2_log_root=root / "pm2",
                systemd_reference_roots=(root / "etc-systemd",),
                symlink_scan_root=root / "deploy",
                process_root=root / "proc",
                state_reference_roots=(root / "state",),
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
            # Creating the dependency payload refreshes the directory mtime.
            # Make it old again so the existing retention algorithm would delete it
            # unless it explicitly follows and protects current-release dependencies.
            old_stamp = now - 10 * 86400
            os.utime(dependency, (old_stamp, old_stamp))

            report = retention.CleanupReport(dry_run=False)
            retention.cleanup_releases(paths, report, now)

            self.assertTrue(dependency.exists(), "dependency release backing current .venv2 must be retained")
            self.assertTrue((current / ".venv2/bin/python").exists(), "current dependency symlink must remain resolvable")


if __name__ == "__main__":
    unittest.main()
