import unittest
from unittest.mock import patch
import hashlib
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts/ops/deploy"))
from stable4_adopted_monitor_bundle import render, bind_pengu_instance

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
    def test_posix_state_and_final_exec_pins(self):
        sha="a"*40
        files=render(sha)["files"]
        root="/var/lib/disdex/stable4-dd30-monitor/"+sha
        for unit, pins in (
            ("disdex-pengu-dual-ls-v2", {
                "PENGU_DUAL_LS_V2_STATE_DIR":root+"/pengu",
                "PENGU_DUAL_LS_V2_MONITOR_TICK_PATH":root+"/pengu/monitor-tick.json",
                "PENGU_DUAL_LS_V2_MODE":"SHADOW",
                "PENGU_DUAL_LS_V2_LIVE_EXECUTION_ENABLED":"false"}),
            ("disdex-idle-priority-short", {
                "DISDEX_IDLE_PRIORITY_STATE_PATH":root+"/idle/state.json",
                "DISDEX_IDLE_PRIORITY_DECISION_PATH":root+"/idle/decision.json",
                "DISDEX_IDLE_PRIORITY_DECISION_DETAILS_PATH":root+"/idle/decision-details.json",
                "DISDEX_IDLE_RESIDUAL_LONG_ENABLED":"false",
                "DISDEX_IDLE_RESIDUAL_LONG_OPERATOR_ARMED":"false",
                "DISDEX_IDLE_PRIORITY_OPERATOR_ARMED":"false"})):
            text=files[unit+"@"+sha+".service.d/90-adopted-monitor.conf"]
            launch=next(x for x in text.splitlines() if x.startswith("ExecStart=/usr/bin/env "))
            for k,v in pins.items():
                self.assertIn(k+"="+v+" ",launch+" ")
                self.assertEqual([x for x in text.splitlines() if x.startswith("Environment="+k+"=")],["Environment="+k+"="+v])
            self.assertNotIn(chr(92)+"var"+chr(92),text)

    def test_lifecycle_is_review_only_and_exact_sha_scoped(self):
        sha="a"*40
        bundle=render(sha)
        plan=bundle["connectionPlan"]
        self.assertFalse(plan["automaticActivation"])
        self.assertTrue(plan["requiresSeparateOwnerApprovedMonitorPlan"])
        self.assertFalse(plan["legacyHypeUnitMayBeStarted"])
        self.assertEqual(plan["installBeforeAnyStart"],sorted(bundle["files"]))
        self.assertEqual(plan["startOrder"][0],bundle["observerTimer"])
        self.assertEqual(plan["startOrder"][-1],bundle["h48ShadowUnit"])
        self.assertEqual(plan["stopOrder"][0],bundle["h48ShadowUnit"])
        self.assertEqual(plan["stopOrder"][-1],plan["observerUnit"])
        self.assertTrue(all(sha in u for u in plan["startOrder"]+plan["stopOrder"]))
        self.assertTrue(all(sha in d and d.startswith("/var/lib/disdex/") for d in plan["stateDirectories"]))
        self.assertEqual(plan["requiredExternalUnits"],["disdex-v4-rate-budget-broker@"+sha+".service"])
        for unit in plan["runnerUnits"][:2]:
            self.assertIn("Wants="+bundle["observerTimer"],bundle["files"][unit+".d/90-adopted-monitor.conf"])

    def test_h48_read_only_budget_is_pinned_at_both_exec_boundaries(self):
        text=render("a"*40)["files"]["disdex-h48-stop8-shadow@.service"]
        for prefix in ("ExecStartPre=/usr/bin/env ", "ExecStart=/usr/bin/env "):
            line=next(x for x in text.splitlines() if x.startswith(prefix))
            self.assertIn("DISDEX_H48_MODE=SHADOW ",line)
            self.assertIn("DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH=/var/lib/disdex/shared/aster-rate-budget.json ",line)
            self.assertIn("--protected-stop8-shadow",line)
            self.assertIn("DISDEX_ASTER_RATE_BUDGET_PROXY_SOCKET=/run/disdex-v4-budget-%i/budget.sock ",line)

    def test_observer_uses_same_sha_broker_without_credentials_or_direct_fallback(self):
        unit=render("a"*40)["files"]["disdex-stable4-market-observer@.service"]
        self.assertIn("Requires=disdex-v4-rate-budget-broker@%i.service",unit)
        self.assertIn("After=disdex-v4-rate-budget-broker@%i.service",unit)
        self.assertIn("ExecStartPre=/usr/bin/test -S /run/disdex-v4-budget-%i/budget.sock",unit)
        launch=next(x for x in unit.splitlines() if x.startswith("ExecStart="))
        self.assertTrue(launch.startswith("ExecStart=/usr/bin/env -i "))
        for pin in ("DISDEX_RELEASE_SHA=%i", "DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH=/var/lib/disdex/shared/aster-rate-budget.json", "DISDEX_ASTER_RATE_BUDGET_PROXY_SOCKET=/run/disdex-v4-budget-%i/budget.sock"):
            self.assertIn(pin+" ",launch)
        self.assertNotIn("EnvironmentFile=",unit)
        self.assertNotIn("ReadWritePaths=/var/lib/disdex/shared",unit)
        self.assertIn("InaccessiblePaths=/etc/disdex",unit)
        self.assertIn("ProtectSystem=strict",unit)
        self.assertIn("scripts/stable4-market-observe.ts %i /var/lib/disdex/stable4-observation/%i/snapshot.json",launch)

    def test_pengu_instance_explicit_safety_writer_pins(self):
        sha="a"*40
        margin="disdex-v12-v52-margin-guard@"+"b"*40+".service"
        risk="disdex-shared-crypto-risk@"+"c"*40+".service"
        raw=b"[Unit]\nAfter=network-online.target disdex-shared-crypto-risk@%i.service disdex-v12-v52-margin-guard@%i.service\nWants=network-online.target disdex-shared-crypto-risk@%i.service disdex-v12-v52-margin-guard@%i.service\n"
        with patch("stable4_adopted_monitor_bundle.PENGU_TEMPLATE_SHA256",hashlib.sha256(raw).hexdigest()):
            bundle=render(sha,pengu_template=raw,margin_unit=margin,risk_unit=risk)
            self.assertTrue(bundle["connectionPlan"]["penguInstanceBoundToExistingWriters"])
            self.assertFalse(bundle["connectionPlan"]["preStartBlockers"])
            unit=bundle["files"]["disdex-pengu-dual-ls-v2@"+sha+".service"]
            self.assertIn("After=network-online.target "+risk+" "+margin,unit)
            self.assertNotIn("disdex-shared-crypto-risk@%i.service",unit)
            with self.assertRaises(ValueError):bind_pengu_instance(sha,raw+b" ",margin,risk)
            with self.assertRaises(ValueError):bind_pengu_instance(sha,raw,margin.replace("b"*40,sha),risk)
        self.assertTrue(render(sha)["connectionPlan"]["preStartBlockers"])
        with self.assertRaises(ValueError):render(sha,pengu_template=raw)

    def test_bad_sha_rejected(self):
        for bad in ("master","../other","a"*39,"a"*40+";"):
            with self.assertRaises(ValueError):render(bad)
if __name__=="__main__":unittest.main()
