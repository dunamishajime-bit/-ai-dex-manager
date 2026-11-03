import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePendingRefreshGrant } from '../scripts/ops/root/disdex-pending-exposure-readonly-reconcile';

const now=1_793_665_000_000, sha='a'.repeat(40), hash='b'.repeat(64);
const grant={schema:'disdex-pending-refresh-root-grant/v1',scope:'PENDING_RECONCILE_ONLY',
 repository:'dunamishajime-bit/-ai-dex-manager',target:'DD1296_FINAL_ALLIN_10BPS',
 route:'CODEX_SSH',authorizationMethod:'ROOT_SSH_SESSION',ordersEnabled:false,
 sourceSha:sha,registryHash:hash,parentPid:1234,nonce:'c'.repeat(32),issuedAt:now-1000,expiresAt:now+59000};
const context={now,sha,registryHash:hash,parentPid:1234};

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
