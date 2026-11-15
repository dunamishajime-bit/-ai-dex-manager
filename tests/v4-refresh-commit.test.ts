import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {validateV4RefreshCommit} from '../lib/v12-v4-refresh-commit';

const payload={rootProof:true};
const sha='a'.repeat(40),hash=createHash('sha256').update(JSON.stringify(payload,null,2)+'\n').digest('hex'),now=1793660000000;
const hashes={establishedAsterOrders:hash,signedAsterAccount:hash,sharedRiskAndPeers:hash};
const commit={schema:'disdex-v4-dynamic-evidence-commit/v1',sha,
 scope:'V4_EVIDENCE_REFRESH_ONLY',ordersEnabled:false,authorizesTrading:false,
 refreshGeneration:'generation-one',capturedAt:new Date(now-1000).toISOString(),
 leaseId:'c'.repeat(32),leaseApprovedAt:Math.floor(now/1000)-60,
 leaseExpiresAt:Math.floor(now/1000)+3600,planSha256:'d'.repeat(64),
 evidenceSha256:hashes,evidencePayloads:{establishedAsterOrders:payload,signedAsterAccount:payload,sharedRiskAndPeers:payload}};

test('a root-published refresh commit binds exactly the three mutable evidence files',()=>{
 assert.deepEqual(validateV4RefreshCommit(commit,sha,now),hashes);
});
test('a 30-day lease still requires evidence no older than 15 minutes',()=>{
 const extended={...commit,leaseExpiresAt:commit.leaseApprovedAt+30*86400};
 assert.deepEqual(validateV4RefreshCommit(extended,sha,now),hashes);
 assert.throws(()=>validateV4RefreshCommit(extended,sha,now+900000),/COMMIT_STALE/);
});
test('expired, stale, future, wrong-SHA and widened refresh commits fail closed',()=>{
 for(const patch of [{sha:'e'.repeat(40)},{ordersEnabled:true},{authorizesTrading:true},
  {scope:'FULL_PROJECT'},{leaseExpiresAt:Math.floor(now/1000)},
  {leaseApprovedAt:Math.floor(now/1000)+1},{leaseExpiresAt:commit.leaseApprovedAt+30*86400+1},
  {capturedAt:new Date(now-900001).toISOString()},{capturedAt:new Date(now+1).toISOString()},
  {refreshGeneration:''},{leaseId:''},{planSha256:'invalid'},
  {evidenceSha256:{...hashes,routeSourceParity:hash}},
  {evidenceSha256:{...hashes,signedAsterAccount:'invalid'}},
  {evidencePayloads:{...commit.evidencePayloads,signedAsterAccount:{tampered:true}}}]) {
  assert.throws(()=>validateV4RefreshCommit({...commit,...patch},sha,now),/V4_REFRESH_(?:COMMIT_(?:INVALID|STALE)|LEASE_EXPIRED)/);
 }
});
