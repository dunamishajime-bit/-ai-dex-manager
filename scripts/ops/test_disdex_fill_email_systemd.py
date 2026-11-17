"""Systemd notification-only unit contract, without running or contacting Gmail."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
SERVICE = ROOT / "ops/systemd/disdex-trade-fill-email-dispatch.service"
TIMER = ROOT / "ops/systemd/disdex-trade-fill-email-dispatch.timer"


class FillEmailUnitContractTests(unittest.TestCase):
    def test_nontrading_service_has_only_existing_mail_env_and_readonly_inbox(self):
        text = SERVICE.read_text(encoding="utf8")
        for key in (
            "User=deploy", "Group=deploy",
            "EnvironmentFile=/etc/disdex/ai-dex-manager-mail.env",
            "NoNewPrivileges=true", "ProtectSystem=strict",
            "ReadOnlyPaths=/var/lib/disdex/shared/trade-fill-notifications/inbox.jsonl",
            "ReadWritePaths=/var/lib/disdex/shared/trade-fill-notifications",
            "ExecStart=/usr/bin/python3 -B /usr/local/libexec/disdex-notify/disdex_fill_email_dispatch.py --once",
        ):
            self.assertIn(key, text)
        for forbidden in (
            "ASTER_API", "DISDEX_SHARED_KILL_SWITCH", "systemctl start",
            "systemctl restart", "ExecStartPost=", "ExecStopPost=",
            "--bootstrap", "/home/deploy/disdex-trading/current",
        ):
            self.assertNotIn(forbidden, text)

    def test_timer_has_no_trading_mutations_and_is_bounded(self):
        text = TIMER.read_text(encoding="utf8")
        self.assertIn("OnUnitInactiveSec=60s", text)
        self.assertIn("Unit=disdex-trade-fill-email-dispatch.service", text)
        self.assertIn("WantedBy=timers.target", text)
        self.assertNotIn("KillSwitch", text)


if __name__ == "__main__":
    unittest.main()
