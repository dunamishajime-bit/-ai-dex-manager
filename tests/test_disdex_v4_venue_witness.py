import sys
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"/"ops"/"deploy"))
import disdex_v4_venue_witness as m

SHA="a"*40
OLD="7"*40

class VenueWitnessContractTest(unittest.TestCase):
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
