"""Deterministic source patch ONLY, pinned to e6afd908 preimages.

Default is check/print hashes; --apply is explicit and only edits the named Git
source directory. Never run this against a deployed release. No Git mutations,
registry writes, service operations, API access or credential reads occur here.
"""
import argparse
import hashlib
import json
from pathlib import Path

BASE='e6afd90883544bbe9d3a6bf9e13614fa9737c65a'
PREIMAGES={
 'lib/disdex-pending-owner-evidence.ts':'2c0feda03e0333e11b3fd8deaf41353595bd46f9376cf10d9cfe54ea787b7b48',
 'scripts/ops/root/disdex-pending-exposure-readonly-reconcile.ts':'61676c8bbe6680b93a1f84f5d9d20673ef99f15a4832a2b158e1280b292bf6f0',
 'scripts/ops/deploy/disdex_pending_maintenance.py':'8bcc07c78338d10bf969f8833447512505e236507b165c7c3c5209ba86fbe2ca',
}
HELPERS=['disdex-pending-h48-composite.ts','disdex-pending-protected-hold.ts','disdex-pending-owned-witness.ts']
def digest(s):return hashlib.sha256(s.encode()).hexdigest()
def replace(text,old,new):
 if text.count(old)!=1:raise ValueError('PATCH_ANCHOR_COUNT:'+repr(old[:90])+':'+str(text.count(old)))
 return text.replace(old,new,1)
def transform(source,helpers):
 for path,expected in PREIMAGES.items():
  if digest(source[path])!=expected:raise ValueError('PATCH_PREIMAGE_MISMATCH:'+path)
 out=dict(source);key='lib/disdex-pending-owner-evidence.ts';s=out[key]
 s=replace(s,"type Row=Record<string,any>;","import {matchesPendingProtectedHold,verifyPendingProtectedHold,type PendingProtectedHoldCapability} from './disdex-pending-protected-hold';\ntype Row=Record<string,any>;")
 s=replace(s,'orders:Row[],ledger:Row|undefined,heartbeat:Row|undefined,marker:string,now:number,sha:string,runtime:V4Runtime,','orders:Row[],ledger:Row|undefined,heartbeat:Row|undefined,marker:string,now:number,sha:string,runtime:V4Runtime,protectedHold?:PendingProtectedHoldCapability,')
 s=replace(s," const ownPeerBlock=heartbeat?.safetyState==='BLOCKED'&&peerUnavailable.test(heartbeat.reason);"," const ownPeerBlock=heartbeat?.safetyState==='BLOCKED'&&peerUnavailable.test(heartbeat.reason);\n const ownProtectedHold=matchesPendingProtectedHold(protectedHold,heartbeat??{},ledger??{},sha,now);")
 s=replace(s,'!(ownHealthy||ownPeerBlock)','!(ownHealthy||ownPeerBlock||ownProtectedHold)')
 s=replace(s,'export type PendingOwnerEvidence={input:Parameters<typeof validateOwnedPendingVenue>[0];verifyUnchanged:()=>Promise<void>};','export type PendingOwnerEvidence={input:Parameters<typeof validateOwnedPendingVenue>[0];sourceEvidence:{files:Record<string,string>};verifyUnchanged:()=>Promise<void>};')
 s=replace(s,'export async function collectPendingOwnerEvidence(positions:Row[],orders:Row[],runtimeSha:string):Promise<PendingOwnerEvidence>{','export async function collectPendingOwnerEvidence(positions:Row[],orders:Row[],runtimeSha:string,options:{protectedHold?:PendingProtectedHoldCapability}={}):Promise<PendingOwnerEvidence>{')
 s=replace(s,"records.V4_MARKER.raw??'',Date.now(),manifest.pins.V12,runtime);","records.V4_MARKER.raw??'',Date.now(),manifest.pins.V12,runtime,options.protectedHold);")
 s=replace(s,' return {input,verifyUnchanged:async()=>{',' const holdFiles=options.protectedHold?await verifyPendingProtectedHold(options.protectedHold):{};\n const files=Object.fromEntries([...required].map(key=>{const record=records[key];if(record.raw===undefined)throw Error("PENDING_OWNER_REQUIRED_FILE_MISSING");return[record.path,hash(record.raw)];}));\n return {input,sourceEvidence:{files:{...files,...holdFiles}},verifyUnchanged:async()=>{\n  if(options.protectedHold)await verifyPendingProtectedHold(options.protectedHold);')
 out[key]=s;key='scripts/ops/root/disdex-pending-exposure-readonly-reconcile.ts';s=out[key]
 # Only the committed, non-trading root service grant is extended; interactive
 # v1 grants remain bounded to 60 seconds. The source/registry/PID checks and
 # the final expiry check remain in force throughout the native journal replay.
 s=replace(s,'g.expiresAt-g.issuedAt>60_000','g.expiresAt-g.issuedAt>(service?600_000:60_000)')
 s=replace(s,"import {collectPendingOwnerEvidence} from '../../../lib/disdex-pending-owner-evidence';","import {collectPendingOwnerEvidence} from '../../../lib/disdex-pending-owner-evidence';\nimport {preflightPendingV4Replay,preparePendingCompositeOwnership,buildPendingCompositeWitness} from '../../../lib/disdex-pending-owned-witness';\nimport {attestPendingNoOrderRootParent} from '../../../lib/disdex-pending-protected-hold';")
 s=replace(s,'export function parsePendingReconcileArgs(argv: readonly string[]) {','export function parsePendingReconcileArgs(argv: readonly string[]):{apply:boolean;verifyOwned?:boolean;witnessNonce?:string} {\n  if(argv.length===2&&argv[0]==="--owned-venue-witness"&&/^[a-f0-9]{32}$/.test(argv[1]))return{apply:false,verifyOwned:true,witnessNonce:argv[1]};')
 s=replace(s,'const { apply,verifyOwned } = parsePendingReconcileArgs(process.argv.slice(2));','const { apply,verifyOwned,witnessNonce } = parsePendingReconcileArgs(process.argv.slice(2));')
 s=replace(s,'  const lock = new FileAccountOrderLock(lockPath, 120_000, pendingPath);','  const workerSha=String(process.env.DISDEX_RELEASE_SHA||"");\n  const service=grant?.schema==="disdex-pending-refresh-root-grant/v2";\n  const replay=service||verifyOwned?await preflightPendingV4Replay():undefined;\n  const context=witnessNonce?await attestPendingNoOrderRootParent(workerSha,{requestNonce:witnessNonce}):service?await attestPendingNoOrderRootParent(workerSha,{grant}):undefined;\n  const lock = new FileAccountOrderLock(lockPath, 120_000, pendingPath);')
 s=replace(s,'const handle = await lock.acquire("PENDING_READONLY_RECONCILE:" + process.pid + ":" + Date.now());','const handle = await lock.acquire(witnessNonce?"PENDING_READONLY_WITNESS":"PENDING_READONLY_RECONCILE:" + process.pid + ":" + Date.now());')
 s=replace(s,'  if (!handle) throw new Error("PENDING_RECONCILE_ACCOUNT_LOCK_BUSY");\n  try {','  if (!handle) throw new Error("PENDING_RECONCILE_ACCOUNT_LOCK_BUSY");\n  let renewalError:unknown;\n  const keepAlive=setInterval(()=>{void handle.renew().catch(error=>{renewalError=error;});},20000);keepAlive.unref();\n  const assertRenewal=()=>{if(renewalError)throw Error("PENDING_RECONCILE_LEASE_RENEWAL_FAILED");};\n  try {')
 s=replace(s,'    const positions=await client.getPositions();\n    const openOrders=await client.getOpenOrders();\n    const balances=await client.getBalances();','    const positions=await client.getPositions();const positionsObservedAt=Date.now();\n    const openOrders=await client.getOpenOrders();const ordersObservedAt=Date.now();\n    const balances=await client.getBalances();const balancesObservedAt=Date.now();')
 s=replace(s,"    const service=grant?.schema==='disdex-pending-refresh-root-grant/v2';\n    const nonFlat=",'    const nonFlat=')
 s=replace(s,"    const ownership=(service||verifyOwned)&&nonFlat?await collectPendingOwnerEvidence(positions as JsonRecord[],openOrders as JsonRecord[],String(process.env.DISDEX_RELEASE_SHA||'')):undefined;","    const composite=replay?await preparePendingCompositeOwnership({positions:positions as JsonRecord[],orders:openOrders as JsonRecord[],workerSha,lease:handle,client,context,replay}):undefined;\n    const ownership=composite?.ownership??((service||verifyOwned)&&nonFlat?await collectPendingOwnerEvidence(positions as JsonRecord[],openOrders as JsonRecord[],workerSha):undefined);")
 s=replace(s,'      positions: positions as unknown as JsonRecord[],\n      openOrders: openOrders as unknown as JsonRecord[],','      positions: composite?.partition.positions??positions as unknown as JsonRecord[],\n      openOrders: openOrders as unknown as JsonRecord[],')
 s=replace(s,'    if(ownership)await ownership.verifyUnchanged();\n\n    const verifiedAt = Date.now();','    if(ownership)await ownership.verifyUnchanged();\n    if(composite)await composite.verifyUnchanged();\n    assertRenewal();\n    if(witnessNonce){\n      if(!composite)throw Error("PENDING_WITNESS_COMPOSITE_REQUIRED");\n      const proof=await buildPendingCompositeWitness({workerSha,requestNonce:witnessNonce,positions:positions as JsonRecord[],orders:openOrders as JsonRecord[],signedObservedAt:{positions:positionsObservedAt,orders:ordersObservedAt,balances:balancesObservedAt},registrySha256:sha256(before.raw),lease:handle,composite});\n      const last=await trustedRegistry(pendingPath);if(sha256(last.raw)!==sha256(before.raw))throw Error("PENDING_RECONCILE_REGISTRY_CHANGED_DURING_PROOF");\n      await composite.verifyUnchanged();assertRenewal();console.log(JSON.stringify(proof));return;\n    }\n\n    const verifiedAt = Date.now();')
 s=replace(s,'      if(ownership)await ownership.verifyUnchanged();\n      const next =','      if(ownership)await ownership.verifyUnchanged();\n      if(composite)await composite.verifyUnchanged();\n      assertRenewal();\n      const next =')
 s=replace(s,'      positionCount: checked.positionCount,\n      openOrderCount: checked.openOrderCount,','      positionCount: composite?.positionCount??checked.positionCount,\n      openOrderCount: composite?.openOrderCount??checked.openOrderCount,')
 s=replace(s,"      ownershipMode:ownership?'PINNED_OWNER_PROOF':'FLAT_NO_OPEN_ORDERS',","      ownershipMode:(composite?.positionCount??checked.positionCount)||(composite?.openOrderCount??checked.openOrderCount)?'PINNED_OWNER_PROOF':'FLAT_NO_OPEN_ORDERS',")
 s=replace(s,'  } finally {\n    await handle.release();\n  }\n}', '  } finally {\n    clearInterval(keepAlive);\n    await handle.release();\n  }\n}')
 out[key]=s;key='scripts/ops/deploy/disdex_pending_maintenance.py';s=out[key]
 s=replace(s,'    grant=build_grant(sha,registry_hash,parent_pid,now,nonce)\n    grant.update(', '    grant=build_grant(sha,registry_hash,parent_pid,now,nonce)\n    grant["expiresAt"]=now+600000\n    grant.update(')
 s=replace(s,"'TimeoutStartSec=60s\\nTimeoutStopSec=10s\\nRuntimeMaxSec=60s\\n'", "'TimeoutStartSec=660s\\nTimeoutStopSec=10s\\nRuntimeMaxSec=660s\\n'")
 s=replace(s,'def run_signed_child(release,deploy,*,grant_path=None,credentials=None,verify_owned=False):','def run_signed_child(release,deploy,*,grant_path=None,credentials=None,verify_owned=False,witness_nonce=None):\n    if witness_nonce is not None:require(isinstance(witness_nonce,str) and re.fullmatch(r"[a-f0-9]{32}",witness_nonce),"PENDING_WITNESS_NONCE_INVALID")')
 s=replace(s,"        '--apply-refresh' if grant_path is not None else '--verify-owned' if verify_owned else '--verify-only'],cwd=release,","        *(['--owned-venue-witness',witness_nonce] if witness_nonce is not None else ['--apply-refresh' if grant_path is not None else '--verify-owned' if verify_owned else '--verify-only'])],cwd=release,")
 s=replace(s,'env=child_environment(release.name,deploy.pw_dir,grant_path,credentials),capture_output=True,text=True,timeout=55)','env=child_environment(release.name,deploy.pw_dir,grant_path,credentials),capture_output=True,text=True,timeout=600)')
 s=replace(s,"    require(sys.argv[1:] in [['--service-cycle'],['--verify-only']],'PENDING_MAINTENANCE_MODE_REQUIRED')","    witness_nonce=sys.argv[2] if len(sys.argv)==3 and sys.argv[1]=='--owned-venue-witness' else None\n    require(sys.argv[1:] in [['--service-cycle'],['--verify-only']] or witness_nonce is not None,'PENDING_MAINTENANCE_MODE_REQUIRED')\n    if witness_nonce is not None:require(re.fullmatch('[a-f0-9]{32}',witness_nonce),'PENDING_WITNESS_NONCE_INVALID')")
 s=replace(s,"    release=source_release();deploy=pwd.getpwnam('deploy')","    release=source_release();deploy=pwd.getpwnam('deploy')\n    if witness_nonce is not None:\n        for name in ['disdex-pending-h48-composite.ts','disdex-pending-protected-hold.ts','disdex-pending-owned-witness.ts']:secure(release/'lib'/name)\n        row=run_signed_child(release,deploy,credentials=load_server_credentials(),verify_owned=True,witness_nonce=witness_nonce)\n        require(row.get('schema')=='disdex-composite-owner-witness/v1' and row.get('workerSha')==release.name and row.get('requestNonce')==witness_nonce,'PENDING_WITNESS_CHILD_BINDING')\n        print(json.dumps(row,sort_keys=True),flush=True);return")
 compile(s,key,'exec');out[key]=s
 for name in HELPERS:out['lib/'+name]=helpers[name]
 return out
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--source-root',required=True);parser.add_argument('--apply',action='store_true');args=parser.parse_args()
 root=Path(args.source_root).resolve();here=Path(__file__).resolve().parent
 if not (root/'.git').exists() or '/releases/' in root.as_posix():raise ValueError('PATCH_REQUIRES_GIT_SOURCE_NOT_RELEASE')
 source={p:(root/p).read_text(encoding='utf8') for p in PREIMAGES};helpers={name:(here/name).read_text(encoding='utf8') for name in HELPERS}
 result=transform(source,helpers)
 if args.apply:
  for path,text in result.items():
   target=(root/path).resolve()
   if not target.is_relative_to(root):raise ValueError('PATCH_OUTPUT_ESCAPED_SOURCE')
   target.write_text(text,encoding='utf8',newline='\n')
 print(json.dumps({'status':'SOURCE_PATCH_APPLIED' if args.apply else 'SOURCE_PATCH_CHECKED','baseSha':BASE,'files':{p:digest(s) for p,s in result.items()},'liveOperations':0},sort_keys=True))
if __name__=='__main__':main()
