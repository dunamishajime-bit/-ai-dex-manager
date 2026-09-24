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
        self.assertIn("Environment=QUALITY102_CAUSAL_V1_MAX_GROSS=3.0", source)
        self.assertIn("Environment=QUALITY102_CAUSAL_V1_SELECTOR_MODE=CAUSAL_V4", source)
        self.assertIn("Environment=FET_BRK48_LIVE_ENABLED=true", source)
        self.assertIn("Environment=FET_BRK48_STATE_PATH=/var/lib/disdex/fet-brk48-residual/state.json", source)
        self.assertIn("Environment=FET_BRK48_MAX_GROSS=2.25", source)
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
        self.assertGreaterEqual(source.count("StartLimitIntervalSec=300s"), 5)
        self.assertGreaterEqual(source.count("StartLimitBurst=3"), 5)
        self.assertGreaterEqual(source.count("RestartSec=30s"), 5)
        self.assertIn("Environment=QUALITY102_LIVE_ENABLED=false", source)
        self.assertIn("Environment=QUALITY102_LIVE_SELECTOR_PARITY=false", source)
        self.assertGreaterEqual(source.count("EnvironmentFile=${CONTRACT_ENV_FILE}"), 5)
        self.assertIn("DISDEX_V96_V52_MARGIN_GUARD_STATE_DIR=/var/lib/disdex/shared/margin-risk", source)
        self.assertIn("DISDEX_V52_ASTER_ONLY_STATE_DIR=/var/lib/disdex/v52-aster-only", source)
        self.assertIn("DISDEX_V13D_V11EQ_V96_KILL_SWITCH_FILE=${SHARED_ROOT}/kill-switch.json", source)

    def test_wiring_normalizes_live_state_ownership_and_hardens_runner_startup(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn("normalize_live_state_ownership()", source)
        self.assertIn("normalize_live_state_ownership", source)
        self.assertIn("chown deploy:deploy \"$state_path\"", source)
        self.assertIn("chmod 0600 \"$state_path\"", source)
        self.assertIn("chown deploy:deploy /var/lib/disdex/pengu-dual-ls-v2/runner-live.json", source)
        self.assertIn("chown deploy:deploy /var/lib/disdex/quality102-causal-v1/state.json", source)
        self.assertIn("chown deploy:deploy /var/lib/disdex/fet-brk48-residual/state.json", source)
        self.assertIn("chmod 600 /var/lib/disdex/pengu-dual-ls-v2/runner-live.json", source)
        self.assertIn("chmod 600 /var/lib/disdex/quality102-causal-v1/state.json", source)

    def test_wiring_restores_required_monitor_timers(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn("ensure_monitor_timer_active()", source)
        self.assertIn('ensure_monitor_timer_active "disdex-runner-health-snapshot.timer"', source)
        self.assertIn('ensure_monitor_timer_active "disdex-runner-health-alert.timer"', source)
        self.assertIn("DISDEX_MONITOR_TIMER_ACTIVE", source)
        # Recovery/watchdog automation is intentionally conditional on the
        # operator activation artifact after the premature-activation incident.
        self.assertIn("if operator_activation_all_trading_ready; then", source)
        self.assertIn("systemctl enable --now disdex-runner-watchdog.timer", source)
        self.assertIn("systemctl disable --now disdex-runner-watchdog.timer", source)

    def test_wiring_script_does_not_stop_or_cancel_trading(self):
        source = SCRIPT.read_text(encoding="utf-8")
        # The hardening may stop automation helpers while activation is absent,
        # but must never directly stop a real trading runner.
        self.assertNotIn('systemctl stop "$V12_UNIT"', source)
        self.assertNotIn('systemctl stop "$PENGU_UNIT"', source)
        self.assertNotIn('systemctl stop "$Q102_UNIT"', source)
        self.assertNotIn('systemctl stop "$FET_UNIT"', source)
        self.assertNotIn('systemctl stop "$V52_UNIT"', source)
        self.assertNotIn("systemctl cancel", source)
        self.assertNotIn("pkill", source)


if __name__ == "__main__":
    unittest.main()
