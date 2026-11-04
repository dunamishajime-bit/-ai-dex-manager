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
    def test_shared_runtime_metadata_is_not_an_operator_artifact(self):
        good=dict(uid=1000,gid=1000,mode=0o100600,parent_uid=1000,parent_gid=1000,parent_mode=0o40770)
        for path in [m.RISK,m.MARGIN,m.KILL,m.PENDING]:
            self.assertTrue(m.validate_shared_runtime_metadata(path,**good,deploy_uid=1000,deploy_gid=1000))
            self.assertTrue(m.validate_shared_runtime_metadata(path,**dict(good,mode=0o100660),deploy_uid=1000,deploy_gid=1000))
        for key,value in [('uid',999),('gid',999),('mode',0o100666),('parent_uid',999),('parent_mode',0o40777)]:
            with self.subTest(key=key),self.assertRaises(ValueError):
                m.validate_shared_runtime_metadata(m.MARGIN,**dict(good,**{key:value}),deploy_uid=1000,deploy_gid=1000)
        with self.assertRaises(ValueError):
            m.validate_shared_runtime_metadata(Path('/etc/disdex/approval.json'),**good,deploy_uid=1000,deploy_gid=1000)
    def bounded_snapshot(self,now=2_000_000_000_000):
        from datetime import datetime,timezone
        captured=datetime.fromtimestamp((now-1000)/1000,timezone.utc).isoformat(timespec="milliseconds").replace("+00:00","Z")
        keys=["establishedAsterOrders","signedAsterAccount","sharedRiskAndPeers"]
        return dict(status="V4_BOUNDED_EVIDENCE_SNAPSHOT_VERIFIED",candidateSha=SHA,
            certificateSchema="disdex-v12-v4-production-certification/v4",
            certificateValidUntilMs=now+600000,leaseExpiresAtMs=now+60000,
            capturedAt=captured,capturedAtMs=now-1000,refreshGeneration="generation-1",
            evidencePayloads={k:dict(candidateSha=SHA,status="PASS",capturedAt=captured,
                refreshGeneration="generation-1") for k in keys})

    def test_bounded_snapshot_uses_one_real_source_generation(self):
        raw=self.bounded_snapshot()
        self.assertIs(m.validate_bounded_snapshot(raw,SHA,2_000_000_000_000),raw)

    def test_bounded_snapshot_cannot_rewrap_old_wrong_sha_or_mixed_proofs_as_fresh(self):
        now=2_000_000_000_000
        for field,value in [("capturedAtMs",now-180001),("capturedAtMs",now+1),
            ("candidateSha",OLD),("certificateSchema","disdex-v12-v4-production-certification/v3"),
            ("status","PASS"),("leaseExpiresAtMs",now),("certificateValidUntilMs",now-1)]:
            raw=self.bounded_snapshot();raw[field]=value
            with self.subTest(field=field),self.assertRaises(ValueError):m.validate_bounded_snapshot(raw,SHA,now)
        for field,value in [("refreshGeneration","generation-0"),("capturedAt","2000-01-01T00:00:00.000Z"),
                             ("candidateSha",OLD),("status","FAIL")]:
            raw=self.bounded_snapshot();raw["evidencePayloads"]["signedAsterAccount"][field]=value
            with self.subTest(field=field),self.assertRaises(ValueError):m.validate_bounded_snapshot(raw,SHA,now)

    def test_preflight_reads_candidate_certificate_and_atomic_commit_not_legacy_files(self):
        command=m.bounded_evidence_command(SHA,Path('/home/deploy/disdex-trading/releases')/SHA)
        self.assertEqual(command[:2],["/usr/bin/node","--import"])
        script=command[-2]
        for required in ["readV4ProductionCertificate","validateV4RefreshCommit","refresh-commit.json","O_NOFOLLOW"]:
            self.assertIn(required,script)
        self.assertNotIn("disdex-v12-v4-evidence-preflight.mjs",command)

    def test_collector_keeps_source_capture_time_and_never_reads_old_dynamic_files(self):
        now=2_000_000_000_000;raw=self.bounded_snapshot(now)
        payloads=raw["evidencePayloads"]
        for k in ["establishedAsterOrders","signedAsterAccount"]:
            payloads[k].update(readOnly=True,mutationCalls=0,positions=[],openOrders=[])
        payloads["signedAsterAccount"]["signedGet"]=True
        payloads["sharedRiskAndPeers"].update(sharedRiskHealthy=True,marginGuardHealthy=True,killSwitch=False,pendingCount=0)
        with patch.object(m.os,"geteuid",return_value=0,create=True), \
            patch.object(m,"_assert_release",return_value=m.RELEASES/SHA), \
            patch.object(m,"refresh_and_preflight",return_value=raw), \
            patch.object(m,"_assert_runtime_health",return_value=({"maximumLossPct":7.5},[])), \
            patch.object(m,"validate_units_and_ticks"), \
            patch.object(m,"_secure_json",side_effect=AssertionError("legacy dynamic file read")):
            proof=m.collect_v4_venue_evidence(sha=SHA,expected_pins={},phase="before",now=now//1000)
        self.assertEqual(proof["capturedAt"],(now-1000)//1000)
        self.assertEqual(proof["expiresAt"],(now-1000)//1000+180)
        self.assertNotEqual(proof["capturedAt"],now//1000)
        self.assertTrue(proof["signatureVerified"])

    def test_quantity_coverage_and_nonempty_client_id_do_not_prove_stop_ownership(self):
        now=2_000_000_000_000;raw=self.bounded_snapshot(now)
        payloads=raw["evidencePayloads"]
        position={"symbol":"DOGEUSDT","positionSide":"BOTH","positionAmt":"-226","entryPrice":"0.08"}
        stop={"symbol":"DOGEUSDT","clientOrderId":"UNRECOGNIZED_OWNER","orderId":"123",
            "side":"BUY","type":"STOP_MARKET","origQty":"226","executedQty":"0",
            "reduceOnly":True,"status":"NEW","stopPrice":"0.09"}
        for k in ["establishedAsterOrders","signedAsterAccount"]:
            payloads[k].update(readOnly=True,mutationCalls=0,positions=[position],openOrders=[stop])
        payloads["signedAsterAccount"]["signedGet"]=True
        payloads["sharedRiskAndPeers"].update(sharedRiskHealthy=True,marginGuardHealthy=True,killSwitch=False,pendingCount=0)
        with patch.object(m.os,"geteuid",return_value=0,create=True), \
            patch.object(m,"_assert_release",return_value=m.RELEASES/SHA), \
            patch.object(m,"refresh_and_preflight",return_value=raw), \
            patch.object(m,"_assert_runtime_health",return_value=({"maximumLossPct":7.5},[])), \
            patch.object(m,"validate_units_and_ticks"):
            with self.assertRaisesRegex(ValueError,"OWNERSHIP_NOT_CERTIFIED"):
                m.collect_v4_venue_evidence(sha=SHA,expected_pins={},phase="before",now=now//1000)

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

    def test_full_live_healthy_no_signal_does_not_require_an_order(self):
        now=2_000_000_000_000
        pins=self._pins();pins["V12_V4"]=SHA
        def systemd(unit,prop):
            return "active" if prop=="ActiveState" else "4242"
        def secure(path,*args,**kwargs):
            if path==m.V4_HEARTBEAT:
                return dict(schema="disdex-v12-v4-runner-heartbeat/v1",
                    releaseSha=SHA,runtimeSha=SHA,expectedSha=SHA,
                    serviceUnit=f"disdex-v12-v4@{SHA}.service",mainPid=4242,
                    mode="LIVE",liveEnabled=True,limitedLive=False,safetyState="HEALTHY",
                    orderEnabled=False,ordersAllowed=False,
                    heartbeatAt=now-500,lastTickAt=now-1000)
            return self._fake_hb(path,now)
        with patch.object(m,"_systemd",side_effect=systemd),patch.object(m,"_secure_json",side_effect=secure):
            m.validate_units_and_ticks(pins,"after",SHA,now)

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
