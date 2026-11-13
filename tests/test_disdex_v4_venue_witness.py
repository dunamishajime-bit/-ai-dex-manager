import sys
from types import SimpleNamespace
from datetime import datetime, timezone
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"/"ops"/"deploy"))
import disdex_v4_venue_witness as m

SHA="a"*40
OLD="7"*40

class VenueWitnessContractTest(unittest.TestCase):
    def test_runtime_health_rejects_missing_trip_state_and_malformed_pending_entries(self):
        now = 1793596500000
        risk = {"sourceComplete": True, "tripped": False, "utcDay": "2026-11-02",
                "updatedAt": now - 1000, "maximumLossPct": 7.5}
        margin = {"stage": "HEALTHY", "ordersAllowed": True, "checkedAt": now - 1000}
        def check(risk_value, entries):
            records = {m.RISK: risk_value, m.MARGIN: margin, m.KILL: {"active": False},
                       m.PENDING: {"entries": entries}}
            no_lock = SimpleNamespace(exists=lambda: False, is_symlink=lambda: False)
            with patch.object(m, "ACCOUNT_LOCK", no_lock), \
                 patch.object(m, "_secure_runtime_json", side_effect=lambda path: records[path]):
                return m._assert_runtime_health(now)
        check(risk, [])
        check(risk, [{"status": "RELEASED"}])
        for bad_risk in ({k: v for k, v in risk.items() if k != "tripped"},
                         dict(risk, tripped=None), dict(risk, tripped=0)):
            with self.subTest(risk=bad_risk):
                with self.assertRaises(ValueError):
                    check(bad_risk, [])
        for entries in ([None], [1], [{"status": "PENDING"}], [{}]):
            with self.subTest(entries=entries):
                with self.assertRaises(ValueError):
                    check(risk, entries)

    def test_collector_rejects_stale_future_missing_or_mixed_generation_evidence(self):
        now = 1793596500
        captured = datetime.fromtimestamp(now - 1, timezone.utc).isoformat()
        common = {"status": "PASS", "candidateSha": SHA, "capturedAt": captured,
                  "refreshGeneration": "generation-1", "readOnly": True,
                  "mutationCalls": 0}
        orders = dict(common, positions=[], openOrders=[])
        account = dict(common, signedGet=True, positions=[], openOrders=[])
        risk = dict(common, sharedRiskHealthy=True, marginGuardHealthy=True,
                    killSwitch=False, pendingCount=0)

        def collect(records, *, phase="before", peer_stop_approvals=None):
            def read(path):
                return records[Path(path).name]
            with patch.object(m.os, "geteuid", return_value=0, create=True), \
                 patch.object(m, "_assert_release", return_value=Path(".")), \
                 patch.object(m, "_assert_runtime_health", return_value=({"maximumLossPct": 7.5}, [])), \
                 patch.object(m, "validate_units_and_ticks"), \
                 patch.object(m, "_secure_json", side_effect=read):
                return m.collect_v4_venue_evidence(sha=SHA, expected_pins={},
                                                   phase=phase, now=now, refresh=False,
                                                   peer_stop_approvals=peer_stop_approvals)

        records = {"established-aster-orders.json": orders,
                   "signed-aster-account.json": account,
                   "shared-risk-and-peers.json": risk}
        result = collect(records)
        self.assertFalse(result["heartbeatVerified"], "pre-cutover does not verify the V4 heartbeat")
        self.assertFalse(result["tickVerified"], "pre-cutover does not verify the V4 tick")
        post_cutover = collect(records, phase="after")
        self.assertTrue(post_cutover["heartbeatVerified"])
        self.assertTrue(post_cutover["tickVerified"])
        peer_stopped = collect(records, phase="after", peer_stop_approvals={"PENGU_V8": {}})
        self.assertFalse(peer_stopped["heartbeatVerified"])
        self.assertFalse(peer_stopped["tickVerified"])
        for name, source in records.items():
            for changes in ({"capturedAt": datetime.fromtimestamp(now - 31, timezone.utc).isoformat()},
                            {"capturedAt": datetime.fromtimestamp(now + 6, timezone.utc).isoformat()},
                            {"capturedAt": None}, {"capturedAt": "2026-11-02T05:15:00"},
                            {"refreshGeneration": "other"}, {"refreshGeneration": ""}):
                with self.subTest(name=name, changes=changes):
                    bad = dict(records, **{name: dict(source, **changes)})
                    with self.assertRaises(ValueError):
                        collect(bad)
        self.assertLessEqual(result["expiresAt"], now - 1 + 180)
        at_upper_skew = datetime.fromtimestamp(now + 5, timezone.utc).isoformat()
        future_records = {name: dict(source, capturedAt=at_upper_skew)
                          for name, source in records.items()}
        self.assertLessEqual(collect(future_records)["expiresAt"], now + 180)

    def test_shared_runtime_owner_and_modes_are_bound_to_deploy(self):
        self.assertTrue(m._valid_runtime_metadata(1001, 1001, 0o100600, 1001, 1001, 1001, 1001))
        self.assertTrue(m._valid_runtime_metadata(1001, 1001, 0o100660, 1001, 1001, 1001, 1001))
        self.assertFalse(m._valid_runtime_metadata(1002, 1001, 0o100600, 1001, 1001, 1001, 1001))
        self.assertFalse(m._valid_runtime_metadata(1001, 1001, 0o100666, 1001, 1001, 1001, 1001))
        self.assertFalse(m._valid_runtime_metadata(1001, 1001, 0o100660, 1002, 1001, 1001, 1001))

    def test_flat_only_witness_does_not_claim_nonflat_stop_ownership(self):
        self.assertTrue(m._assert_flat_witness([], []))
        with self.assertRaisesRegex(ValueError, "NONFLAT"):
            m._assert_flat_witness(self._position(), self._stop())
        with self.assertRaisesRegex(ValueError, "NONFLAT"):
            m._assert_flat_witness([], self._stop())

    def test_missing_position_quantity_is_not_treated_as_flat(self):
        with self.assertRaisesRegex(ValueError, "INVALID_NUMERIC:positionAmt"):
            m.normalize_positions([{"symbol": "DOGEUSDT"}])

    def test_shared_risk_requires_current_utc_day_and_fresh_source(self):
        now_ms = 1793596500000
        valid = {"utcDay": "2026-11-02", "updatedAt": now_ms - 1000}
        self.assertTrue(m._risk_is_fresh(valid, now_ms))
        self.assertFalse(m._risk_is_fresh(dict(valid, utcDay="2026-11-01"), now_ms))
        self.assertFalse(m._risk_is_fresh(dict(valid, updatedAt=now_ms - 900001), now_ms))
        self.assertFalse(m._risk_is_fresh(dict(valid, updatedAt=now_ms + 1001), now_ms))

    def _peer_stop_approval(self, now):
        return {
            "schema": "disdex-peer-stop-approval/v1",
            "status": "APPROVED",
            "runner": "PENGU_V8",
            "approvedSha": OLD,
            "deploymentTarget": "professional-dismanager.net",
            "operatorTarget": "DD1296_FINAL_ALLIN_10BPS",
            "operator": "owner",
            "planSha256": "b" * 64,
            "ordersEnabled": False,
            "approvedAt": now - 1,
            "expiresAt": now + 60,
            "operatorAcknowledgement": "I_ACK_PENGU_V8_PEER_STOP_NO_ORDERS",
            "nonceDigest": "c" * 64,
        }

    def test_position_normalization_ignores_mark_price_but_binds_entry_and_size(self):
        first=m.normalize_positions([{
            "symbol":"DOGEUSDT","positionSide":"BOTH","positionAmt":"-226",
            "entryPrice":"0.08052","markPrice":"0.071",
        }])
        second=m.normalize_positions([{
            "symbol":"DOGEUSDT","positionSide":"BOTH","positionAmt":"-226.0",
            "entryPrice":"0.080520","markPrice":"0.079",
        }])
        self.assertEqual(first,second)
        changed=m.normalize_positions([{
            "symbol":"DOGEUSDT","positionSide":"BOTH","positionAmt":"-225",
            "entryPrice":"0.08052",
        }])
        self.assertNotEqual(first,changed)

    def _position(self):
        return m.normalize_positions([{
            "symbol":"DOGEUSDT","positionSide":"BOTH",
            "positionAmt":"-226","entryPrice":"0.08052",
        }])

    def _stop(self, **patches):
        row={
            "symbol":"DOGEUSDT","clientOrderId":"v12-v4-stop",
            "orderId":"123","side":"BUY","type":"STOP_MARKET",
            "origQty":"226","executedQty":"0","reduceOnly":True,
            "status":"NEW","stopPrice":"0.085",
        }
        row.update(patches)
        return m.normalize_orders([row])

    def test_exact_reduce_only_stop_covers_short(self):
        self.assertEqual(m.protective_stop_counts(self._position(),self._stop()),(0,0))

    def test_partial_unknown_and_wrong_side_fail(self):
        self.assertEqual(
            m.protective_stop_counts(self._position(),self._stop(origQty="225")),(0,1))
        unknown,partial=m.protective_stop_counts(
            self._position(),self._stop(reduceOnly=False))
        self.assertGreaterEqual(unknown,1)
        self.assertGreaterEqual(partial,1)
        unknown,partial=m.protective_stop_counts(
            self._position(),self._stop(side="SELL"))
        self.assertGreaterEqual(unknown,1)
        self.assertGreaterEqual(partial,1)

    def _pins(self):
        return {runner:(OLD if runner!="V12_V4" else OLD) for runner in m.PREFIXES}

    def _fake_hb(self,path,now_ms,stale=False):
        name=Path(path).name
        reverse={v[0]:k for k,v in m.HEARTBEATS.items()}
        runner=reverse[name]
        sha=OLD
        return {
            "schema":"disdex-runner-heartbeat/v1",
            "runnerId":runner,
            "runtimeSha":sha,
            "expectedSha":sha,
            "serviceUnit":f"{m.PREFIXES[runner]}@{sha}.service",
            "heartbeatAt":now_ms-(180_000 if stale else 1_000),
            "lastTickAt":now_ms-1_000,
        }

    def test_before_requires_every_peer_active_and_fresh(self):
        now=2_000_000_000_000
        pins=self._pins()
        def systemd(unit,prop):
            is_v4=unit.startswith("disdex-v12-v4@")
            if prop=="ActiveState": return "failed" if is_v4 else "active"
            if prop=="MainPID": return "0" if is_v4 else "4242"
            raise AssertionError(prop)
        def secure(path,*args,**kwargs):
            return self._fake_hb(path,now)
        with patch.object(m,"_systemd",side_effect=systemd), patch.object(m,"_secure_json",side_effect=secure):
            m.validate_units_and_ticks(pins,"before",SHA,now)

    def test_stale_peer_heartbeat_fails_closed(self):
        now=2_000_000_000_000
        pins=self._pins()
        def systemd(unit,prop):
            is_v4=unit.startswith("disdex-v12-v4@")
            return ("failed" if is_v4 else "active") if prop=="ActiveState" else ("0" if is_v4 else "4242")
        def secure(path,*args,**kwargs):
            return self._fake_hb(path,now,stale=Path(path).name=="v52.json")
        with patch.object(m,"_systemd",side_effect=systemd), patch.object(m,"_secure_json",side_effect=secure):
            with self.assertRaisesRegex(ValueError,"HEARTBEAT_STALE"):
                m.validate_units_and_ticks(pins,"before",SHA,now)

    def test_inactive_pengu_requires_explicit_owner_peer_stop_approval(self):
        now=2_000_000_000_000
        pins=self._pins()
        def systemd(unit,prop):
            is_v4=unit.startswith("disdex-v12-v4@")
            is_pengu=unit.startswith("disdex-pengu-dual-ls-v2@")
            if prop=="ActiveState": return "failed" if is_v4 or is_pengu else "active"
            if prop=="MainPID": return "0" if is_v4 or is_pengu else "4242"
            raise AssertionError(prop)
        def secure(path,*args,**kwargs):
            return self._fake_hb(path,now)
        with patch.object(m,"_systemd",side_effect=systemd), patch.object(m,"_secure_json",side_effect=secure):
            with self.assertRaisesRegex(ValueError,"RUNNER_NOT_ACTIVE:PENGU_V8"):
                m.validate_units_and_ticks(pins,"before",SHA,now)
            approval=self._peer_stop_approval(now // 1000)
            m.validate_peer_stop_approval(approval, runner="PENGU_V8", sha=OLD, now=now // 1000)
            m.validate_units_and_ticks(
                pins,"before",SHA,now,
                peer_stop_approvals={"PENGU_V8": approval},
            )

    def test_peer_stop_approval_rejects_wrong_sha_or_order_authority(self):
        now=2_000_000_000
        approval=self._peer_stop_approval(now)
        for field, value in (("approvedSha", SHA), ("ordersEnabled", True),
                             ("operatorAcknowledgement", "I_APPROVE")):
            with self.subTest(field=field):
                invalid=dict(approval, **{field: value})
                with self.assertRaises(ValueError):
                    m.validate_peer_stop_approval(
                        invalid, runner="PENGU_V8", sha=OLD, now=now)

if __name__=="__main__":
    unittest.main()
