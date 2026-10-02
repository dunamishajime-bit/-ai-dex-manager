import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WIRING = ROOT / "scripts" / "ops" / "root" / "disdex-current-runtime-wiring"
WATCHDOG = ROOT / "scripts" / "ops" / "root" / "disdex-runner-watchdog-current.mjs"


class RuntimeWiringHygieneTest(unittest.TestCase):
    def test_watchdog_ignores_inactive_and_failed_historical_instances(self):
        source = WATCHDOG.read_text(encoding="utf-8")
        self.assertIn('if (match && !new Set(["inactive", "failed"]).has(match[2])) units.push(match[1]);', source)

    def test_wiring_resets_stale_failed_instances_before_monitor_reactivation(self):
        source = WIRING.read_text(encoding="utf-8")
        self.assertIn("reset_stale_release_failed_units", source)
        reset_call = source.index("  reset_stale_release_failed_units", source.index("systemctl daemon-reload"))
        monitor_call = source.index('systemctl enable --now disdex-v12-kill-switch-auto-repair.path')
        self.assertLess(reset_call, monitor_call)

    def test_wiring_pins_trade_history_sync_to_current_release(self):
        source = WIRING.read_text(encoding="utf-8")
        self.assertIn('HISTORY_SYNC_DROPIN_DIR=', source)
        self.assertIn('scripts/disdex-aster-trade-history-git-sync.ts', source)
        self.assertIn('EnvironmentFile=/etc/disdex/disdex-quality102-causal-v1.env', source)
        self.assertIn('ExecStart=${CURRENT_RELEASE}/node_modules/.bin/tsx scripts/disdex-aster-trade-history-git-sync.ts', source)

    def test_stale_support_cleanup_includes_history_sync_dropins(self):
        source = WIRING.read_text(encoding="utf-8")
        start = source.index("remove_stale_support_release_pin_dropins()")
        end = source.index("reset_stale_release_failed_units()", start)
        self.assertIn('"$HISTORY_SYNC_DROPIN_DIR"', source[start:end])

    def test_history_sync_writes_the_common_current_support_override(self):
        source = WIRING.read_text(encoding="utf-8")
        self.assertIn(
            'write_atomic "${HISTORY_SYNC_DROPIN_DIR}/${CURRENT_SUPPORT_OVERRIDE}"',
            source,
        )
        self.assertNotIn(
            'write_atomic "${HISTORY_SYNC_DROPIN_DIR}/zzzzzzzzzzzz-current-release.conf"',
            source,
        )

    def test_health_alert_pins_safety_units_to_current_release(self):
        source = WIRING.read_text(encoding="utf-8")
        self.assertIn('HEALTH_ALERT_DROPIN_DIR=', source)
        self.assertIn('write_atomic "${HEALTH_ALERT_DROPIN_DIR}/${CURRENT_SUPPORT_OVERRIDE}"', source)
        self.assertIn('DISDEX_ALERT_SHARED_CRYPTO_RISK_SERVICE_UNIT=${SHARED_RISK_UNIT}', source)
        self.assertIn('DISDEX_ALERT_MARGIN_GUARD_SERVICE_UNIT=${MARGIN_UNIT}', source)
        start = source.index("remove_stale_health_alert_unit_pin_dropins()")
        end = source.index("reset_stale_release_failed_units()", start)
        self.assertIn('HEALTH_ALERT_DROPIN_DIR', source[start:end])


    def test_monitor_timers_must_be_waiting_not_merely_active(self):
        source = WIRING.read_text(encoding="utf-8")
        self.assertIn('sub_state="$(systemctl show "$unit" -p SubState --value', source)
        self.assertIn('"$sub_state" == "waiting"', source)
        self.assertIn('"$sub_state" == "running"', source)
        self.assertIn('for attempt in $(seq 1 15)', source)
        self.assertIn('DISDEX_MONITOR_TIMER_BUSY_WAIT', source)
        self.assertIn('systemctl restart "$unit"', source)
        self.assertIn('ensure_monitor_timer_active "disdex-runner-position-recovery.timer"', source)

    def test_q102_observer_cleanup_enumerates_real_instances(self):
        source = WIRING.read_text(encoding="utf-8")
        self.assertIn("timers.target.wants", source)
        self.assertIn("systemctl list-units --all --type=timer", source)
        self.assertIn('systemctl reset-failed "${unit%.timer}.service"', source)


    def test_support_timer_units_rearm_from_activation_not_boot(self):
        for name in [
            "disdex-runner-health-alert.timer",
            "disdex-runner-position-recovery.timer",
            "disdex-trade-fill-notifier.timer",
        ]:
            source = (ROOT / "ops" / "systemd" / name).read_text(encoding="utf-8")
            self.assertIn("OnActiveSec=", source, name)
            self.assertNotIn("OnBootSec=", source, name)
        wiring = WIRING.read_text(encoding="utf-8")
        self.assertIn("ops/systemd/disdex-runner-health-alert.timer", wiring)
        self.assertIn("ops/systemd/disdex-runner-position-recovery.timer", wiring)
        self.assertIn("ops/systemd/disdex-trade-fill-notifier.timer", wiring)

    def test_position_recovery_state_is_release_scoped_and_backed_up(self):
        source = WIRING.read_text(encoding="utf-8")
        self.assertIn("normalize_position_recovery_state_lineage()", source)
        self.assertIn("disdex-runner-position-recovery/v1", source)
        self.assertIn('backup="$state.before-$DEPLOYED_SHA-', source)
        self.assertIn("position recovery state is malformed and will not be rewritten", source)
        self.assertIn("normalize_position_recovery_state_lineage", source)

    def test_cutover_defers_operator_automation_until_safety_ready(self):
        cutover = (ROOT / "scripts" / "ops" / "root" / "disdex-idle-production-redeploy-20261001").read_text(encoding="utf-8")
        self.assertIn("DISDEX_CURRENT_RUNTIME_DEFER_OPERATOR_AUTOMATION=true", cutover)
        self.assertIn("CUTOVER_POSTSTART_WIRING_PASS", cutover)
        safety_wait = cutover.index("wait_safety_daemons_ready")
        post_start = cutover.index("CUTOVER_POSTSTART_WIRING_BEGIN")
        self.assertLess(safety_wait, post_start)


    def test_coherence_guard_tracks_full_current_runtime(self):
        guard = (ROOT / "scripts" / "ops" / "root" / "disdex-current-runtime-coherence-guard").read_text(encoding="utf-8")
        for family in [
            "disdex-v12-x1-all",
            "disdex-pengu-dual-ls-v2",
            "disdex-quality102-causal-v1",
            "disdex-v52-aster-only",
            "disdex-fet-brk48",
            "disdex-hype-long",
            "disdex-idle-priority-short",
            "disdex-shared-crypto-risk",
            "disdex-v12-v52-margin-guard",
        ]:
            self.assertIn(f'"{family}"', guard)
        for heartbeat in ["fet-brk48-residual.json", "hype-trend-long.json", "idle-priority-short.json"]:
            self.assertIn(heartbeat, guard)
        self.assertIn("q102_observer_singleton", guard)
        self.assertIn("support_runtime_current", guard)
        self.assertIn("verify_current_units_active || return 20", guard)
        self.assertIn("zzzzzzzzzzzzzzzzzzzz-current-release.conf", guard)

    def test_coherence_guard_timer_is_restart_safe_and_wired(self):
        timer = (ROOT / "ops" / "systemd" / "disdex-current-runtime-coherence-guard.timer").read_text(encoding="utf-8")
        service = (ROOT / "ops" / "systemd" / "disdex-current-runtime-coherence-guard.service").read_text(encoding="utf-8")
        self.assertIn("OnActiveSec=2min", timer)
        self.assertNotIn("OnBootSec=", timer)
        self.assertIn("ExecStart=/usr/local/sbin/disdex-current-runtime-coherence-guard --auto", service)
        wiring = WIRING.read_text(encoding="utf-8")
        self.assertIn("ops/systemd/disdex-current-runtime-coherence-guard.service", wiring)
        self.assertIn("ops/systemd/disdex-current-runtime-coherence-guard.timer", wiring)
        self.assertIn('ensure_monitor_timer_active "disdex-current-runtime-coherence-guard.timer"', wiring)


    def test_wiring_retires_stale_enabled_sha_instances(self):
        source = WIRING.read_text(encoding="utf-8")
        self.assertIn("retire_stale_release_enabled_units()", source)
        self.assertIn("/etc/systemd/system/multi-user.target.wants/disdex-*@*.service", source)
        self.assertIn('systemctl disable --now "$unit"', source)
        self.assertIn('[[ "$sha" == "$DEPLOYED_SHA" ]] && continue', source)
        self.assertIn("retire_stale_release_enabled_units", source)


    def test_wiring_prunes_only_inactive_unprotected_release_metadata(self):
        source = WIRING.read_text(encoding="utf-8")
        self.assertIn("prune_stale_runtime_metadata()", source)
        self.assertIn('"$TRADING_ROOT/previous"', source)
        self.assertIn('"$NODE_MODULES_SOURCE_SHA"', source)
        self.assertIn('"$PYTHON_RUNTIME_SOURCE_SHA"', source)
        self.assertIn('stale runtime metadata still belongs to a live unit', source)
        self.assertIn('rm -f -- "$path"', source)
        self.assertIn('rm -rf -- "$path"', source)
        self.assertIn("prune_stale_runtime_metadata", source)


if __name__ == "__main__":
    unittest.main()
