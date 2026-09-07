import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "ops" / "root" / "disdex-current-runtime-wiring"


class RuntimeWiringScriptTest(unittest.TestCase):
    def test_wiring_is_current_sha_driven_and_has_read_only_mode(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn('CURRENT_RELEASE="$(readlink -f -- "$TRADING_CURRENT")"', source)
        self.assertIn('[[ "$DEPLOYED_SHA" =~ ^[0-9a-f]{40}$ ]]', source)
        self.assertIn("--check|--apply", source)
        self.assertIn("DISDEX_WATCHDOG_EXPECTED_SHA=${DEPLOYED_SHA}", source)
        self.assertIn("DISDEX_HEALTH_SNAPSHOT_EXPECTED_SHA=${DEPLOYED_SHA}", source)
        self.assertIn("DISDEX_V96_STATE_DIR=${V52_LEGACY_CRYPTO_ROOT}", source)
        self.assertIn("Environment=V12_LIVE_ACK=${DEPLOYED_SHA}", source)
        self.assertIn("Environment=STRICT_PORTFOLIO_PLANNER_ACTIVE=true", source)
        self.assertIn("ExecStart=/usr/bin/python3 scripts/disdex_v96_v52_margin_guard_runtime.py --mode live --daemon", source)
        self.assertIn("Environment=QUALITY102_CAUSAL_V1_MAX_GROSS=1.0", source)
        self.assertIn("Environment=QUALITY102_CAUSAL_V1_SELECTOR_MODE=CAUSAL_V4", source)
        self.assertIn('RUNTIME_CONTRACT_ENV_DIR="/etc/disdex/current-runtime"', source)
        self.assertIn('CONTRACT_ENV_FILE="${RUNTIME_CONTRACT_ENV_DIR}/${DEPLOYED_SHA}.env"', source)
        self.assertIn("EnvironmentFile=${CONTRACT_ENV_FILE}", source)
        self.assertIn('PENGU_STATE_ROOT="/var/lib/disdex/pengu-dual-ls-v2"', source)
        self.assertIn("Environment=PENGU_DUAL_LS_V2_STATE_DIR=${PENGU_STATE_ROOT}", source)
        self.assertIn("ReadWritePaths=${PENGU_STATE_ROOT}", source)
        self.assertIn('install -d -o deploy -g deploy -m 0700 "$PENGU_STATE_ROOT"', source)
        self.assertIn("QUALITY102_CAUSAL_V1_MODE=LIVE", source)
        self.assertIn("QUALITY102_CAUSAL_V1_ENABLED=true", source)
        self.assertIn("QUALITY102_CAUSAL_V1_LIVE_TRADING_ENABLED=true", source)
        self.assertIn("QUALITY102_CAUSAL_V1_LIVE_EXECUTION_ENABLED=true", source)
        self.assertIn("QUALITY102_CAUSAL_V1_OPERATOR_ARMED=true", source)
        self.assertGreaterEqual(source.count("EnvironmentFile=${CONTRACT_ENV_FILE}"), 5)
        self.assertIn("DISDEX_V96_V52_MARGIN_GUARD_STATE_DIR=/var/lib/disdex/shared/margin-risk", source)
        self.assertIn("DISDEX_V52_ASTER_ONLY_STATE_DIR=/var/lib/disdex/v52-aster-only", source)
        self.assertIn("DISDEX_V13D_V11EQ_V96_KILL_SWITCH_FILE=${SHARED_ROOT}/kill-switch.json", source)

    def test_wiring_script_does_not_stop_or_cancel_trading(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertNotIn("systemctl stop", source)
        self.assertNotIn("systemctl cancel", source)
        self.assertNotIn("pkill", source)


if __name__ == "__main__":
    unittest.main()
