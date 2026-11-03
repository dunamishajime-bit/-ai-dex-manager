import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePendingRefreshGrant,validatePendingServiceParent } from '../scripts/ops/root/disdex-pending-exposure-readonly-reconcile';

const now=1_793_665_000_000, sha='a'.repeat(40), hash='b'.repeat(64);
const grant={schema:'disdex-pending-refresh-root-grant/v1',scope:'PENDING_RECONCILE_ONLY',
 repository:'dunamishajime-bit/-ai-dex-manager',target:'DD1296_FINAL_ALLIN_10BPS',
 route:'CODEX_SSH',authorizationMethod:'ROOT_SSH_SESSION',ordersEnabled:false,
 sourceSha:sha,registryHash:hash,parentPid:1234,nonce:'c'.repeat(32),issuedAt:now-1000,expiresAt:now+59000};
const context={now,sha,registryHash:hash,parentPid:1234};

test('committed maintenance uses its own explicit v2 grant without claiming an SSH session',()=>{
 const service={...grant,schema:'disdex-pending-refresh-root-grant/v2',route:'ROOT_SERVICE',
   authorizationMethod:'ROOT_COMMITTED_NO_ORDER_MAINTENANCE',maintenanceReceiptSha256:'d'.repeat(64)};
 assert.doesNotThrow(()=>validatePendingRefreshGrant(service,context));
 for(const patch of [{route:'CODEX_SSH'},{authorizationMethod:'ROOT_SSH_SESSION'},
   {maintenanceReceiptSha256:''},{maintenanceReceiptSha256:'owner-approval'},
   {ordersEnabled:true},{scope:'V12_V4'},{parentPid:999}]){
  assert.throws(()=>validatePendingRefreshGrant({...service,...patch},context),/PENDING_REFRESH_GRANT_INVALID/);
 }
});

test('maintenance apply requires the real root parent and exact immutable service entrypoint',()=>{
 const service={...grant,schema:'disdex-pending-refresh-root-grant/v2'};
 const argv=['/usr/bin/python3',`/home/deploy/disdex-trading/releases/${sha}/scripts/ops/deploy/disdex_pending_maintenance.py`,'--service-cycle'];
 assert.doesNotThrow(()=>validatePendingServiceParent(service,{uid:0,argv}));
 for(const patch of [{uid:1000},{argv:['/usr/bin/python3','/tmp/fake.py','--service-cycle']},
   {argv:[...argv,'--skip-gate']},{argv:[argv[0],argv[1],'--verify-only']}]){
  assert.throws(()=>validatePendingServiceParent(service,{uid:0,argv,...patch}),/PARENT_IDENTITY_INVALID/);
 }
});

test('root pending grant authorizes one exact parent, SHA, registry and no-order scope',()=>{
 assert.doesNotThrow(()=>validatePendingRefreshGrant(grant,context));
});
test('pending grant rejects privilege expansion, replay bindings and stale/future authority',()=>{
 for(const patch of [{ordersEnabled:true},{scope:'FULL_PROJECT'},{sourceSha:'d'.repeat(40)},
  {registryHash:'e'.repeat(64)},{parentPid:4321},{nonce:'invalid'},
  {issuedAt:now+1},{expiresAt:now},{expiresAt:now+300001},
  {authorizationMethod:'OWNER_SIGNED_TOKEN'},{route:'GITHUB_ACTIONS'},{target:'OTHER'},
  {repository:'other/repo'},{unexpected:true}]){
  assert.throws(()=>validatePendingRefreshGrant({...grant,...patch},context),/PENDING_REFRESH_GRANT_INVALID/);
 }
});
test('pending grant rejects malformed numeric bindings and empty registry hashes',()=>{
 for(const patch of [{issuedAt:NaN},{expiresAt:Infinity},{parentPid:0},{issuedAt:String(now)},
  {registryHash:''},{sourceSha:''}]) {
  assert.throws(()=>validatePendingRefreshGrant({...grant,...patch},context),/PENDING_REFRESH_GRANT_INVALID/);
 }
});
