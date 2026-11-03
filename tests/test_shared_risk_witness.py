"""No venue calls: exercise the no-order Production evidence boundary."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/ops/deploy'))
import disdex_shared_risk_witness as m

NOW=1793709100519

def proof():
    return dict(status='PENDING_READONLY_RECONCILE_VERIFIED',verifiedAt=NOW,
        positionCount=0,openOrderCount=0,ordersSent=0,cancelsSent=0,positionChangesSent=0,
        beforeHash='b'*64,afterHash='b'*64)

def health():
    return dict(risk=dict(updatedAt=NOW-1000,utcDay='2026-11-03',maximumLossPct=7.5,
        sourceComplete=True,tripped=False,lossPct=0,referenceEquity=100,
        realizedPnl=0,unrealizedPnl=0,fees=0,funding=0,netDailyPnl=0),
        margin=dict(checkedAt=NOW-1000,stage='HEALTHY',ordersAllowed=True),
        pending=dict(updatedAt=NOW-1000,entries=[dict(status='RELEASED',gross=0,notionalUsd=0)]),
        kill=dict(active=True,action='HOLD_PROTECTED'))

class WitnessTest(unittest.TestCase):
    def test_writer_inventory_rejects_a_second_or_unknown_active_writer(self):
        expected='disdex-shared-crypto-risk@'+'c'*40+'.service'
        m.validate_writer_inventory([expected],expected)
        for inventory in [[],[expected,expected],[expected,'unexpected.service']]:
            with self.assertRaises(ValueError):m.validate_writer_inventory(inventory,expected)

    def test_explicit_no_order_proof_preserves_active_kill_without_claiming_v4_ticks(self):
        row=m.build_no_order_witness(proof(),health(),now_ms=NOW,pending_hash='b'*64)
        self.assertEqual(row['scope'],'SHARED_CRYPTO_RISK_ONLY')
        self.assertFalse(row['ordersEnabled'])
        self.assertTrue(row['killSwitchActive'])
        self.assertNotIn('tickVerified',row)
        self.assertNotIn('heartbeatVerified',row)
        self.assertEqual(row['positionsDigest'],row['protectiveOrdersDigest'])

    def test_stale_future_wrong_day_risk_and_missing_pending_are_rejected(self):
        for section,patch in [('risk',dict(updatedAt=NOW-120001)),
                ('risk',dict(updatedAt=NOW+1)),('risk',dict(utcDay='2026-11-02')),
                ('pending',dict(updatedAt=NOW-900001)),('pending',dict(entries=None)),
                ('margin',dict(checkedAt=NOW-900001)),('kill',dict(active=None))]:
            data=health();data[section].update(patch)
            with self.assertRaises(ValueError):m.build_no_order_witness(proof(),data,now_ms=NOW,pending_hash='b'*64)

    def test_counters_and_pnl_cannot_coerce_null_bool_nan_or_missing_into_safety(self):
        for value in [None,True,'0',float('nan'),float('inf')]:
            data=health();data['risk']['fees']=value
            with self.assertRaises(ValueError):m.build_no_order_witness(proof(),data,now_ms=NOW,pending_hash='b'*64)
        for patch in [dict(openOrderCount=1),dict(positionCount=1),dict(ordersSent=False),dict(verifiedAt=NOW-300001)]:
            with self.assertRaises(ValueError):m.build_no_order_witness({**proof(),**patch},health(),now_ms=NOW,pending_hash='b'*64)

    def test_pending_hash_race_active_reservation_and_risk_limit_fail_closed(self):
        for section,patch in [('pending',dict(entries=[dict(status='UNKNOWN')])),
                              ('risk',dict(maximumLossPct=8)),('risk',dict(netDailyPnl=1)),
                              ('risk',dict(tripped=False,lossPct=8))]:
            data=health();data[section].update(patch)
            with self.assertRaises(ValueError):m.build_no_order_witness(proof(),data,now_ms=NOW,pending_hash='b'*64)
        with self.assertRaises(ValueError):m.build_no_order_witness(proof(),health(),now_ms=NOW,pending_hash='c'*64)

    def test_tripped_risk_is_preserved_as_enforcement_not_mislabeled_healthy(self):
        data=health();data['risk'].update(tripped=True,lossPct=8)
        row=m.build_no_order_witness(proof(),data,now_ms=NOW,pending_hash='b'*64)
        self.assertTrue(row['riskTripped'])
        self.assertFalse(row['ordersEnabled'])

    def test_signed_command_is_fixed_get_only_unprivileged_and_no_retry(self):
        argv=m.signed_get_command()
        self.assertEqual(argv[-1],'--verify-only')
        self.assertEqual(argv[0],'/usr/bin/node')
        self.assertEqual(argv[1],'--import')
        self.assertIn(m.SDK_SHA,argv[2])
        self.assertNotIn('--apply-refresh',argv)
        env=m.child_environment(dict(ASTER_API_PRIVATE_KEY='not-a-real-key',SSH_CONNECTION='discard',EVIL='discard'),home='/home/deploy')
        self.assertNotIn('SSH_CONNECTION',env)
        self.assertNotIn('EVIL',env)
        self.assertEqual(env['DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH'],'/var/lib/disdex/shared/aster-rate-budget.json')

if __name__=='__main__':unittest.main()
