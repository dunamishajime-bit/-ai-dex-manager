import unittest
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts/ops/deploy"))
from stable4_adopted_monitor_bundle import render

class TestMonitorBundle(unittest.TestCase):
    def test_exact_sha_observer_and_policy_selection(self):
        sha="a"*40
        bundle=render(sha)
        self.assertIs(bundle["ordersEnabled"],False)
        self.assertIs(bundle["productionInstalled"],False)
        self.assertIs(bundle["formalCertificateIssued"],False)
        files=bundle["files"]
        for base,key,value in (
            ("disdex-v12-v4","DISDEX_STABLE4_V4_ENTRY_POLICY","R21_ONE"),
            ("disdex-pengu-dual-ls-v2","DISDEX_STABLE4_PENGU_ENTRY_POLICY","P91"),
            ("disdex-idle-priority-short","DISDEX_STABLE4_IDLE_ENTRY_POLICY","R26"),
        ):
            f=files[base+"@"+sha+".service.d/90-adopted-monitor.conf"]
            exec_line=[x for x in f.splitlines() if x.startswith("ExecStart=/usr/bin/env ")][0]
            self.assertIn(key+"="+value,exec_line)
            self.assertIn("DISDEX_RELEASE_SHA="+sha,exec_line)
            if value!="R26":
                self.assertIn("DISDEX_STABLE4_RESEARCH_OBSERVATION_PATH=/var/lib/disdex/stable4-observation/"+sha+"/snapshot.json",exec_line)
        self.assertIn("V12_V4_ORDERS_ENABLED=false",files["disdex-v12-v4@"+sha+".service.d/90-adopted-monitor.conf"])
        self.assertIn("PENGU_DUAL_LS_V2_LIVE_EXECUTION_ENABLED=false",files["disdex-pengu-dual-ls-v2@"+sha+".service.d/90-adopted-monitor.conf"])
        self.assertIn("DISDEX_IDLE_R26_LIVE_CERTIFIED=false",files["disdex-idle-priority-short@"+sha+".service.d/90-adopted-monitor.conf"])
    def test_shadow_service_uses_isolated_journal_no_old_trend(self):
        files=render("a"*40)["files"]
        h=files["disdex-h48-stop8-shadow@.service"]
        self.assertIn("DISDEX_H48_MODE=SHADOW",h)
        self.assertIn("--protected-stop8-shadow",h)
        self.assertIn("--initialize-shadow-if-flat",h)
        self.assertIn("/var/lib/disdex/stable4-shadow/%i/h48/journal.json",h)
        self.assertNotIn("disdex-hype-trend-live-runner",h)
        self.assertIn("OnCalendar=*-*-* *:06:00 UTC",files["disdex-stable4-market-observer@.timer"])
    def test_bad_sha_rejected(self):
        for bad in ("master","../other","a"*39,"a"*40+";"):
            with self.assertRaises(ValueError):render(bad)
if __name__=="__main__":unittest.main()
