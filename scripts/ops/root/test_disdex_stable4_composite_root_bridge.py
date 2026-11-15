import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import disdex_stable4_composite_root_bridge as bridge

REF=Path(__file__).resolve().parents[3]/'.tmp/stable4-root-reference-20261115/disdex_v4_venue_witness.py'
SHA='a'*40

class CompositeRootBridgeTests(unittest.TestCase):
    def test_receipt_selects_only_source_and_hash_not_order_authority(self):
        receipt=dict(schema='disdex-stable4-composite-owner-worker/v1',workerSha=SHA,entrypointSha256='b'*64,authorizesTrading=False)
        self.assertEqual(bridge.validate_worker_receipt(receipt),receipt)
        for override in [dict(authorizesTrading=True),dict(workerSha='../other'),dict(entrypointSha256='x'),dict(extra=True)]:
            with self.assertRaises(ValueError):bridge.validate_worker_receipt({**receipt,**override})

    def test_os_process_attestation_never_accepts_child_pid_or_wrong_cwd(self):
        calls=[]
        def run(argv,**kw):
            calls.append(argv)
            return SimpleNamespace(returncode=0,stdout='ActiveState=active\nMainPID=123\n')
        result=bridge.attest_runtime('V12_V4',SHA,run=run,readlink=lambda p:str(bridge.RELEASES/SHA),now_ms=1000)
        self.assertEqual(result['pid'],123)
        self.assertEqual(calls[0][2],'disdex-v12-v4@'+SHA+'.service')
        with self.assertRaises(ValueError):bridge.attest_runtime('V12_V4',SHA,run=run,readlink=lambda p:'/tmp/other')
        with self.assertRaises(ValueError):bridge.attest_runtime('V12_V4',SHA,run=lambda *a,**k:SimpleNamespace(returncode=0,stdout='ActiveState=inactive\nMainPID=0\n'))

    @unittest.skipUnless(REF.exists(),'captured installed public source unavailable')
    def test_actual_generated_witness_keeps_risk_and_legacy_and_scopes_stop_exception(self):
        source=REF.read_bytes();generated=bridge.build_composite_venue_witness(source).decode()
        ast.parse(generated)
        self.assertIn('DYNAMIC_RISK_EVIDENCE_INVALID',generated)
        self.assertIn('SIGNED_ORDER_EVIDENCE_DIVERGED',generated)
        self.assertIn('attest_current_sole_v4_owner',generated)
        self.assertIn('if composite_receipt is not None:',generated)
        # Run the actual generated branch with its actual stop geometry code.
        ns={};tree=ast.parse(source)
        functions=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='protective_stop_counts']
        from decimal import Decimal
        ns['Decimal']=Decimal
        exec(compile(ast.fix_missing_locations(ast.Module(body=functions,type_ignores=[])),'actual-stop-check','exec'),ns)
        start=generated.index('    from disdex_stable4_composite_root_bridge import read_root_receipt')
        end=generated.index('\n    if unknown or partial:',start)
        body=generated[start:end]
        exec('def generated_branch():\n'+body+'\n    return owner_proof,unknown,partial\n',ns)
        ns.update(expected_pins={},account_evidence={'positions':[], 'openOrders':[]},sha=SHA)
        ns['account_positions']=[dict(symbol='HYPEUSDT',positionAmt='1'),dict(symbol='BNBUSDT',positionAmt='1')]
        ns['account_orders']=[]
        with patch.object(bridge,'read_root_receipt',return_value={'enabled':'root'}),patch.object(bridge,'attest_composite_owner',return_value={'protectiveStopSymbols':['BNBUSDT']}):
            _,unknown,partial=ns['generated_branch']()
        self.assertEqual((unknown,partial),(0,1),'H48 exception cannot exempt a BNB missing STOP')
        with self.assertRaises(ValueError):bridge.build_composite_venue_witness(source+b'\n')

if __name__=='__main__':unittest.main()
