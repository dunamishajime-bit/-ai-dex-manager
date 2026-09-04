from __future__ import annotations

import os

import disdex_v52_aster_only_legacy_engine as legacy
from disdex_runner_heartbeat import publish_heartbeat


class V52HeartbeatMixin:
    """Publish one truthful V52 heartbeat for both standalone and combined workers."""

    def _reset_heartbeat_cycle(self) -> None:
        self._heartbeat_outcome = None

    def _record_heartbeat_outcome(self, safety_state: str, last_decision: str, reason: str) -> None:
        self._heartbeat_outcome = (safety_state, last_decision, reason)

    def _publish_v52_heartbeat(self, safety_state: str, last_decision: str, reason: str) -> None:
        self._record_heartbeat_outcome(safety_state, last_decision, reason)
        publish_heartbeat(
            runner_id="V52",
            mode=self.mode.upper(),
            live_enabled=self.live,
            safety_state=safety_state,
            last_decision=last_decision,
            reason=reason,
            caps={"strategy": 1.5, "crypto": 2.0, "total": 2.5},
        )

    def _heartbeat_margin_outcome(self):
        if not self.live:
            return None
        path = getattr(self, "margin_guard_state_path", None)
        if path is None:
            return None
        try:
            row = legacy.base.read_json(path, {}) or {}
        except Exception:
            return ("FAIL_CLOSED", "margin-guard-error", "V52 margin guard state unavailable")
        if not isinstance(row, dict):
            return ("FAIL_CLOSED", "margin-guard-error", "V52 margin guard state invalid")
        stage = str(row.get("stage") or "").strip().upper()
        if stage and stage != "HEALTHY":
            return ("FAIL_CLOSED", f"margin-guard-{stage.lower()}", f"V52_MARGIN_GUARD_{stage}")
        if row.get("ordersAllowed") is False:
            return ("FAIL_CLOSED", "margin-guard-blocked", "V52_MARGIN_GUARD_ORDERS_BLOCKED")
        if not stage:
            return ("FAIL_CLOSED", "margin-guard-error", "V52 margin guard state unavailable")
        return None

    def _heartbeat_shared_risk_outcome(self):
        if not self.live:
            return None
        risk_path = os.getenv("DISDEX_SHARED_CRYPTO_DAILY_RISK_PATH", ".runtime-state/shared/crypto-daily-risk.json")
        try:
            ok, reason, _ = legacy.read_shared_crypto_daily_risk(risk_path)
        except Exception:
            return ("FAIL_CLOSED", "shared-risk-error", "SHARED_CRYPTO_DAILY_RISK_UNAVAILABLE")
        if not ok:
            return ("FAIL_CLOSED", "shared-risk-blocked", f"SHARED_CRYPTO_DAILY_RISK:{reason}")
        return None

    def _heartbeat_daily_loss_outcome(self):
        state = getattr(self, "state", {})
        if not isinstance(state, dict):
            return ("UNKNOWN", "daily-loss-error", "daily-loss state unavailable")
        latch = state.get("v52StrategyDailyLossLatch")
        if isinstance(latch, dict) and (latch.get("tripped") or latch.get("failClosed")):
            return ("DAILY_LOSS_LATCH", "daily-loss-latch", "DAILY_LOSS_TRIPPED")
        if state.get("dailyLossTripped"):
            return ("DAILY_LOSS_LATCH", "daily-loss-latch", "DAILY_LOSS_TRIPPED")
        return None

    def _heartbeat_after_tick(self):
        outcome = getattr(self, "_heartbeat_outcome", None)
        if outcome is not None:
            return outcome
        outcome = self._heartbeat_daily_loss_outcome()
        if outcome is not None:
            return outcome
        outcome = self._heartbeat_shared_risk_outcome()
        if outcome is not None:
            return outcome
        outcome = self._heartbeat_margin_outcome()
        if outcome is not None:
            return outcome
        return ("LIVE" if self.live else "WAITING", "tick", "tick completed")

    def _publish_stopped_heartbeat(self) -> None:
        outcome = getattr(self, "_heartbeat_outcome", None)
        safety_state = outcome[0] if outcome is not None else None
        if safety_state in {
            "FAIL_CLOSED",
            "KILL_SWITCH",
            "DAILY_LOSS_LATCH",
            "STALE_DATA",
            "RECONCILIATION_FAILED",
            "MANUAL_REVIEW",
            "UNKNOWN",
        }:
            return
        self._publish_v52_heartbeat("WAITING", "stopped", "stop requested")

    def kill_switch(self):
        try:
            result = super().kill_switch()
        except Exception:
            self._record_heartbeat_outcome("UNKNOWN", "kill-switch-error", "shared Kill Switch state unavailable")
            raise
        if result:
            reason = result.get("reason") if isinstance(result, dict) else result
            self._record_heartbeat_outcome("KILL_SWITCH", "kill-switch", f"SHARED_KILL_SWITCH:{reason or 'active'}")
        return result

    def enforce_daily_loss(self) -> bool:
        try:
            result = super().enforce_daily_loss()
        except Exception:
            self._record_heartbeat_outcome("UNKNOWN", "daily-loss-error", "daily-loss state unavailable")
            raise
        if result:
            self._record_heartbeat_outcome("DAILY_LOSS_LATCH", "daily-loss-latch", "DAILY_LOSS_TRIPPED")
        return result

    def v96_requires_margin(self) -> bool:
        try:
            result = super().v96_requires_margin()
        except Exception:
            self._record_heartbeat_outcome("FAIL_CLOSED", "v96-margin-error", "V96 margin-priority state unavailable")
            raise
        if result:
            self._record_heartbeat_outcome("FAIL_CLOSED", "v96-margin-priority", "V96_MARGIN_PRIORITY")
        return result

    def tick(self) -> None:
        self._reset_heartbeat_cycle()
        try:
            result = super().tick()
            outcome = self._heartbeat_after_tick()
            self._publish_v52_heartbeat(outcome[0], outcome[1], outcome[2])
            return result
        except Exception as error:
            self._publish_v52_heartbeat("FAIL_CLOSED" if self.live else "UNKNOWN", "tick-error", str(error))
            raise

    def run(self, daemon: bool) -> None:
        self._reset_heartbeat_cycle()
        try:
            super().run(daemon)
        except Exception as error:
            outcome = getattr(self, "_heartbeat_outcome", None)
            if outcome is None or outcome[0] in {"LIVE", "WAITING"}:
                outcome = (
                    "FAIL_CLOSED" if self.live else "UNKNOWN",
                    "run-error",
                    str(error),
                )
            self._publish_v52_heartbeat(
                outcome[0],
                "run-error",
                outcome[2] or str(error),
            )
            raise
        finally:
            self._publish_stopped_heartbeat()
