import sys,unittest,tempfile,os
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/ops/deploy'))
import disdex_shared_risk_monitor_wiring as m
OLD='7'*40;NEW='c'*40

class MonitorWiringTest(unittest.TestCase):
    def test_exact_risk_keys_change_without_touching_peer_settings(self):
        raw='DISDEX_WATCHDOG_V12_EXPECTED_SHA='+OLD+'\nDISDEX_WATCHDOG_SHARED_RISK_EXPECTED_SHA='+OLD+'\n'
        result=m.replace_values(raw,{'DISDEX_WATCHDOG_SHARED_RISK_EXPECTED_SHA':OLD},
            {'DISDEX_WATCHDOG_SHARED_RISK_EXPECTED_SHA':NEW})
        self.assertIn('DISDEX_WATCHDOG_V12_EXPECTED_SHA='+OLD,result)
        self.assertIn('DISDEX_WATCHDOG_SHARED_RISK_EXPECTED_SHA='+NEW,result)
        for bad in [raw.replace(OLD,NEW),raw+raw,'unrelated=x\n']:
            with self.assertRaises(ValueError):m.replace_values(bad,{'DISDEX_WATCHDOG_SHARED_RISK_EXPECTED_SHA':OLD},{'DISDEX_WATCHDOG_SHARED_RISK_EXPECTED_SHA':NEW})

    @unittest.skipIf(os.name=='nt','POSIX atomic metadata and directory fsync')
    def test_scoped_apply_and_rollback_preserve_modes_and_others(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'health.env';p.write_text('PEER=untouched\nRISK='+OLD+'\n');p.chmod(0o640)
            w=m.SharedRiskMonitorWiring([(p,{'RISK':OLD},{'RISK':NEW})],root_uid=os.geteuid())
            w.apply();self.assertEqual(p.read_text(),'PEER=untouched\nRISK='+NEW+'\n')
            self.assertEqual(p.stat().st_mode&0o777,0o640)
            w.assert_applied();w.restore()
            self.assertEqual(p.read_text(),'PEER=untouched\nRISK='+OLD+'\n')

    @unittest.skipIf(os.name=='nt','POSIX atomic metadata and directory fsync')
    def test_rollback_will_not_overwrite_a_concurrent_root_change(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'health.env';p.write_text('RISK='+OLD+'\n');p.chmod(0o600)
            w=m.SharedRiskMonitorWiring([(p,{'RISK':OLD},{'RISK':NEW})],root_uid=os.geteuid())
            w.apply();p.write_text('RISK='+NEW+'\nOTHER=newer\n')
            with self.assertRaises(ValueError):w.restore()
            self.assertIn('OTHER=newer',p.read_text())

if __name__=='__main__':unittest.main()
