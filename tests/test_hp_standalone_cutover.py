import sys
import unittest
from pathlib import Path, PurePosixPath

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/ops/deploy"))
from disdex_hp_standalone_cutover import SESSION, render_dropin


class HpCutoverTest(unittest.TestCase):
    def test_only_the_ui_directory_and_launcher_are_replaced(self):
        old = PurePosixPath("/ui/old")
        new = PurePosixPath("/ui/new")
        original = b"[Service]\nEnvironment=PORT=3001\nWorkingDirectory=/ui/old\nExecStart=\nExecStart=/usr/bin/npm run start\n"
        rendered = render_dropin(original, old, new).decode()
        self.assertIn("Environment=PORT=3001\n", rendered)
        self.assertIn("EnvironmentFile=" + str(SESSION) + "\n", rendered)
        self.assertIn("WorkingDirectory=/ui/new\nExecStart=\nExecStart=/usr/bin/node /ui/new/server.js\n", rendered)
        for bad in (original.replace(b"/ui/old", b"/different"),
                    original + b"ExecStart=/unexpected\n",
                    original + ("EnvironmentFile=" + str(SESSION) + "\n").encode()):
            with self.assertRaises(ValueError):
                render_dropin(bad, old, new)
