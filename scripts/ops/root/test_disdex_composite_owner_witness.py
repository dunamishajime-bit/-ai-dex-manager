import copy
import hashlib
import json
import unittest
from disdex_composite_owner_witness import canonical_digest, inventory_snapshot, composite_probe_command, validate_composite_owner_witness

T=1800000000000
SHA='a'*40
HASH='b'*64
PINS={k:'c'*40 for k in ['V12_V4','PENGU_V8','QUALITY102_CAUSAL_V1','V52','FET_BRK48_RESIDUAL','HYPE_TREND_LONG','IDLE_PRIORITY_SHORT','SHARED_CRYPTO_RISK','MARGIN_GUARD']}

def fixture(h48=False):
    positions=[dict(symbol='BNBUSDT',positionSide='BOTH',positionAmt='-2',entryPrice='600')]
    orders=[dict(symbol='BNBUSDT',clientOrderId='v4-stop-exact',orderId='1',side='BUY',type='STOP_MARKET',origQty='2',executedQty='0',reduceOnly=True,status='NEW',stopPrice='650')]
    owners=[dict(symbol='BNBUSDT',runner='V12_V4',sourceSha=PINS['V12_V4'],policy='RESIDENT_STOP',orderIds=['v4-stop-exact'],certificateSha256=None)]
    if h48:
        positions.append(dict(symbol='HYPEUSDT',positionSide='BOTH',positionAmt='1.5',entryPrice='50'))
        owners.append(dict(symbol='HYPEUSDT',runner='HYPE_TREND_LONG',sourceSha=PINS['HYPE_TREND_LONG'],policy='H48_TIME_ONLY',orderIds=[],certificateSha256='d'*64))
    inventory=inventory_snapshot(positions,orders)
    body=dict(schema='disdex-composite-owner-witness/v1',workerSha=SHA,requestNonce='e'*32,accountScope='ASTER_FUTURES',
              signedObservedAt={'positions':T-1000,'orders':T-500,'balances':T-100},verifiedAt=T,expiresAt=T+30000,
              inventory=inventory,inventorySha256=canonical_digest(inventory),runnerShaMap=copy.deepcopy(PINS),
              cas={'pinManifestSha256':HASH,'registryBeforeSha256':HASH,'registryAfterSha256':HASH,'ownerFilesBefore':{'/var/lib/disdex/v12-v4/orders.json':HASH},'ownerFilesAfter':{'/var/lib/disdex/v12-v4/orders.json':HASH}},
              lease={'ownerId':'PENDING_READONLY_WITNESS','leaseId':'actual-account-lease','acquiredAt':T-2000,'checkedAt':T,'expiresAt':T+60000},
              owners=owners,runtimes=[dict(runner=x['runner'],sourceSha=x['sourceSha'],unit=f"{ {'V12_V4':'disdex-v12-v4','HYPE_TREND_LONG':'disdex-hype-long'}[x['runner']]}@{x['sourceSha']}.service",pid=1000+i,cwd='/home/deploy/disdex-trading/releases/'+x['sourceSha']) for i,x in enumerate(owners)],
              effects={'ordersSent':0,'cancelsSent':0,'positionChangesSent':0,'registryWrites':0})
    if h48:
        certificate='/etc/disdex/stable4/h48-time-only/'+PINS['HYPE_TREND_LONG']+'.json'
        body['cas']['ownerFilesBefore'][certificate]='d'*64
        body['cas']['ownerFilesAfter'][certificate]='d'*64
        body['cas']['ownerFilesBefore']['/var/lib/disdex/hype-zec-long/runner.json']=HASH
        body['cas']['ownerFilesAfter']['/var/lib/disdex/hype-zec-long/runner.json']=HASH
    body['proofSha256']=canonical_digest(body)
    args=dict(worker_sha=SHA,request_nonce='e'*32,expected_pins=PINS,pin_manifest_sha256=HASH,registry_sha256=HASH,positions=positions,orders=orders,root_runtimes={r['runner']:{**{k:r[k] for k in ['sourceSha','unit','pid','cwd']},'observedAt':T+10}for r in body['runtimes']},now_ms=T+10)
    return body,args

class CompositeWitnessTests(unittest.TestCase):
    def validate(self,body,args):return validate_composite_owner_witness(body,**args)
    def test_actual_composite_proof_binds_inventory_digest_and_real_owner_sources(self):
        body,args=fixture(True);result=self.validate(body,args)
        self.assertEqual(result['ownerRunners'],['HYPE_TREND_LONG','V12_V4'])
        self.assertEqual(result['timeOnlySymbols'],['HYPEUSDT'])
        self.assertFalse(result['authorizesTrading'])
    def test_counts_only_existing_worker_output_cannot_become_composite_proof(self):
        _,args=fixture()
        with self.assertRaises(ValueError):self.validate({'status':'PENDING_READONLY_RECONCILE_VERIFIED','ownershipMode':'PINNED_OWNER_PROOF','positionCount':1},args)
    def test_v52_native_state_is_explicit_stock_only_and_does_not_exempt_crypto_stops(self):
        b,a=fixture();a['positions'].append(dict(symbol='NVDAUSDT',positionSide='BOTH',positionAmt='1',entryPrice='100'))
        b['inventory']=inventory_snapshot(a['positions'],a['orders']);b['inventorySha256']=canonical_digest(b['inventory'])
        b['owners'].append(dict(symbol='NVDAUSDT',runner='V52',sourceSha=PINS['V52'],policy='V52_NATIVE_STATE',orderIds=[],certificateSha256=None))
        runtime=dict(runner='V52',sourceSha=PINS['V52'],unit='disdex-v52-aster-only@'+PINS['V52']+'.service',pid=2000,cwd='/home/deploy/disdex-trading/releases/'+PINS['V52'])
        b['runtimes'].append(runtime);a['root_runtimes']['V52']={**{k:runtime[k]for k in ['sourceSha','unit','pid','cwd']},'observedAt':T+10}
        for path in ['/var/lib/disdex/v52-aster-only/runner-live.json','/var/lib/disdex/shared/margin-risk/guard-live.json']:
            b['cas']['ownerFilesBefore'][path]=HASH;b['cas']['ownerFilesAfter'][path]=HASH
        b['proofSha256']=canonical_digest({k:v for k,v in b.items() if k!='proofSha256'})
        result=self.validate(b,a);self.assertEqual(result['nativeStateSymbols'],['NVDAUSDT']);self.assertEqual(result['protectiveStopSymbols'],['BNBUSDT'])
        del b['cas']['ownerFilesBefore']['/var/lib/disdex/shared/margin-risk/guard-live.json'];del b['cas']['ownerFilesAfter']['/var/lib/disdex/shared/margin-risk/guard-live.json']
        b['proofSha256']=canonical_digest({k:v for k,v in b.items() if k!='proofSha256'})
        with self.assertRaises(ValueError):self.validate(b,a)
    def test_unknown_owner_missing_stop_and_foreign_order_fail_even_with_recomputed_digest(self):
        for change in [lambda b:b['owners'][0].update(runner='UNKNOWN'),lambda b:b['owners'][0].update(orderIds=[]),lambda b:b['inventory']['orders'].append({**b['inventory']['orders'][0],'clientOrderId':'foreign'}),lambda b:b['owners'][0].update(sourceSha='f'*40)]:
            b,a=fixture();change(b);b['inventorySha256']=canonical_digest(b['inventory']);b['proofSha256']=canonical_digest({k:v for k,v in b.items() if k!='proofSha256'})
            with self.assertRaises(ValueError):self.validate(b,a)
    def test_h48_is_exact_policy_exemption_not_global_stop_bypass(self):
        for change in [lambda b:b['owners'][0].update(policy='H48_TIME_ONLY',certificateSha256='d'*64,orderIds=[]),lambda b:b['owners'][1].update(certificateSha256=None),lambda b:b['owners'][1].update(symbol='OTHERUSDT')]:
            b,a=fixture(True);change(b);b['proofSha256']=canonical_digest({k:v for k,v in b.items() if k!='proofSha256'})
            with self.assertRaises(ValueError):self.validate(b,a)
    def test_nonce_source_pin_cas_and_lease_expiry_are_independently_bound(self):
        for change in [lambda b:b.update(requestNonce='f'*32),lambda b:b.update(workerSha='f'*40),lambda b:b['runnerShaMap'].update(V12_V4='f'*40),lambda b:b['cas'].update(registryAfterSha256='f'*64),lambda b:b['cas']['ownerFilesAfter'].update({'/var/lib/disdex/v12-v4/orders.json':'f'*64}),lambda b:b['lease'].update(expiresAt=T),lambda b:b['signedObservedAt'].update(positions=T-120001),lambda b:b['effects'].update(registryWrites=1)]:
            b,a=fixture();change(b);b['proofSha256']=canonical_digest({k:v for k,v in b.items() if k!='proofSha256'})
            with self.assertRaises(ValueError):self.validate(b,a)
    def test_flat_is_explicit_signed_empty_not_missing_or_unknown(self):
        b,a=fixture();b['inventory']={'positions':[],'orders':[]};b['inventorySha256']=canonical_digest(b['inventory']);b['owners']=[];b['runtimes']=[];b['cas']['ownerFilesBefore']={};b['cas']['ownerFilesAfter']={};b['proofSha256']=canonical_digest({k:v for k,v in b.items() if k!='proofSha256'});a['positions']=[];a['orders']=[]
        self.assertEqual(self.validate(b,a)['ownerRunners'],[])
        b['inventory']['positions']=None
        with self.assertRaises(ValueError):self.validate(b,a)
    def test_bad_numeric_signed_rows_are_never_coerced_flat(self):
        for bad in [None,True,'',' ',{},[],'NaN','Infinity']:
            with self.assertRaises(ValueError):inventory_snapshot([{'symbol':'BNBUSDT','positionAmt':bad}],[])
    def test_child_cannot_replace_actual_root_pid_cwd_observation_with_fresh_claim(self):
        for change in [lambda b:b['runtimes'][0].update(pid=2000),lambda b:b['runtimes'][0].update(cwd='/tmp/other')]:
            b,a=fixture();change(b);b['proofSha256']=canonical_digest({k:v for k,v in b.items() if k!='proofSha256'})
            with self.assertRaises(ValueError):self.validate(b,a)
        b,a=fixture();a['root_runtimes']['V12_V4']['observedAt']=T-120001
        with self.assertRaises(ValueError):self.validate(b,a)
    def test_command_is_fixed_source_readonly_worker_mode(self):
        command=composite_probe_command(SHA,'e'*32)
        self.assertEqual(command,['/usr/bin/python3','/home/deploy/disdex-trading/releases/'+SHA+'/scripts/ops/deploy/disdex_pending_maintenance.py','--owned-venue-witness','e'*32])
        for bad in ['../escape',SHA+' ',True]:
            with self.assertRaises(ValueError):composite_probe_command(bad,'e'*32)

if __name__=='__main__':unittest.main()
