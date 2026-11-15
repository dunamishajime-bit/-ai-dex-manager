import unittest
from types import SimpleNamespace
from unittest.mock import patch
from disdex_v4_startup_wait_budget import decision_wait_seconds


class WaitBudgetTests(unittest.TestCase):
    def test_first_observation_can_cover_measured_209_second_cold_read(self):
        self.assertGreater(decision_wait_seconds(None), 209)
        self.assertEqual(decision_wait_seconds(1794695101571), 600)

    def test_invalid_or_unbounded_waits_reject(self):
        for value in [True, False, 0, -1, 601, float('inf'), float('nan'), '600']:
            with self.assertRaises(ValueError):
                decision_wait_seconds(None, value)
        for value in [0, -1, True, 1.1, '1']:
            with self.assertRaises(ValueError):
                decision_wait_seconds(value)

    def test_explicit_short_deadline_stays_available(self):
        self.assertEqual(decision_wait_seconds(None, 2), 2)

    def test_actual_observer_waits_for_late_genuine_cycle_without_redating(self):
        try:
            import disdex_v4_root_cutover as observer
            import disdex_v4_venue_witness as witness
        except ImportError:
            self.skipTest('Run this integration test alongside installed root observer on VPS')
        sha='a'*40; pid=1234; release='/home/deploy/disdex-trading/releases/'+sha
        base=1_800_000_000_000; seconds=[0]
        unit='disdex-v12-v4@'+sha+'.service'
        identity=dict(runnerId='V12_V4',runtimeSha=sha,expectedSha=sha,serviceUnit=unit,mainPid=pid,workingDirectory=release)
        health=dict(identity,schema='disdex-v12-v4-runner-heartbeat/v1',releaseSha=sha,mode='LIVE',liveEnabled=True,limitedLive=False,safetyState='HEALTHY',lastTickAt=base+210000,heartbeatAt=base+210000,ordersAllowed=False,orderEnabled=False)
        tick=dict(identity,schema='disdex-runner-tick/v1',tickStartedAt=base,tickCompletedAt=base+210000,newOrdersAllowed=False)
        class FakePath:
            def __init__(self,*parts):self.value='/'.join(str(x).rstrip('/') for x in parts)
            def __str__(self):return self.value
            def __truediv__(self,part):return FakePath(self.value,part)
            def __eq__(self,other):return str(self)==str(other)
            def resolve(self,strict=False):return FakePath(release) if self.value.endswith('/cwd') else self
            def lstat(self):return SimpleNamespace(st_uid=1000)
            def stat(self):return SimpleNamespace(st_uid=1000)
            def read_bytes(self):return ('\0'.join(['/usr/bin/node','--import',release+'/node_modules/tsx/dist/loader.mjs',release+'/scripts/v12-v4-production-runner.ts','--daemon'])+'\0').encode()
        class Systemd:
            def active_state(self,u):return 'active'
            def main_pid(self,u):return pid
            def _state(self,u,key):return '0' if key=='NRestarts' else release
        def read(path,require_root=False):
            value=dict(health if str(path).endswith('heartbeat.json') else tick)
            if seconds[0]<210:value['runtimeSha']='b'*40
            return value
        def sleep(n):seconds[0]+=n
        for previous in [None,base-1]:
            seconds[0]=0
            with patch.object(observer,'Path',FakePath),patch.object(witness,'_secure_json',read):
                result=observer.await_v4_decision_cycle(Systemd(),sha=sha,release=release,pid=pid,started_after_ms=base,previous_tick=previous,sleeper=sleep,clock=lambda:(base/1000)+seconds[0],monotonic=lambda:seconds[0])
            self.assertEqual(seconds[0],210)
            self.assertEqual(result['tickCompletedAt'],base+210000)


if __name__=='__main__':unittest.main()
