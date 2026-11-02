import importlib.util, os, pathlib, unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
MOD=ROOT/"scripts"/"disdex_v52_aster_only_live_engine.py"

class V52MonitorOnlyContractTest(unittest.TestCase):
    def test_source_has_hard_monitor_boundary(self):
        source=MOD.read_text()
        self.assertIn("DISDEX_V52_MONITOR_ONLY",source)
        unit=(ROOT/"deploy/systemd/disdex-v52-monitor@.service").read_text()
        self.assertIn("LIVE_EXECUTION_ENABLED=false",unit)
        self.assertIn("4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81-v52-overrides.env",unit)
        self.assertIn("export DISDEX_RELEASE_SHA=%i",unit)
        self.assertIn("DISDEX_V52_MONITOR_ONLY=true",unit)
        self.assertIn("PYTHONPATH=/home/deploy/dis-dex-manager/.venv-stock/lib/python3.12/site-packages",unit)
        self.assertIn("Requires=disdex-v4-rate-budget-broker@82ec7885505ec7d523ea04c1b0a92570d53a2c21.service",unit)
        self.assertIn("DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH=/var/lib/disdex/shared/aster-rate-budget.json",unit)
        self.assertIn("DISDEX_ASTER_RATE_BUDGET_PROXY_SOCKET=/run/disdex-v4-budget-82ec7885505ec7d523ea04c1b0a92570d53a2c21/budget.sock",unit)
        self.assertIn("DISDEX_V52_MONITOR_BUDGET_BROKER_SHA=82ec7885505ec7d523ea04c1b0a92570d53a2c21",unit)
        self.assertIn("ReadOnlyPaths=/home/deploy/disdex-trading/releases /etc/disdex /var/lib/disdex/shared",unit)
        self.assertIn("ReadWritePaths=/var/lib/disdex/v52-monitor",unit)
        self.assertNotIn("ReadWritePaths=/var/lib/disdex/shared",unit)
        self.assertIn("--monitor-only-daemon",source)
        self.assertIn("runner.preflight(read_only=True)",source)
        self.assertIn("monitor-only environment cannot enter order-capable runner",source)
        self.assertNotIn("create_order", source[source.index("def run_monitor_only_daemon"):source.index("def main()")])

    def test_legacy_preflight_requires_readonly_while_monitoring(self):
        source=(ROOT/"scripts/disdex_v52_aster_only_legacy_engine.py").read_text()
        self.assertIn("V52 monitor-only permits read-only preflight only",source)
        self.assertIn("V52 monitor-only requires LIVE_EXECUTION_ENABLED=false",source)

if __name__=="__main__":
    unittest.main()
