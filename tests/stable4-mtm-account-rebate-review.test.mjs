import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewAccountRebates} from '../scripts/research/stable4-mtm-account-rebate-review.mjs';
const row={incomeType:'APOLLOX_DEX_REBATE_RECOMMENDED',asset:'USDT',time:1001,tranId:'9007199254740993',income:'0.000000000000000001'};
test('account credits remain unallocated with exact totals',()=>{const r=reviewAccountRebates([row,{...row,tranId:'9007199254740994',income:'1.20'}],1000,2000);assert.equal(r.unallocatedCreditUsd,'1.200000000000000001');assert.equal(r.rowCount,2);assert.ok(r.credits.every(c=>c.bucket==='ACCOUNT_CREDIT_UNALLOCATED'&&!('runner' in c)));for(const k of ['orderAuthority','ownerAttestationIssued','signedObservationIssued','runnerAttributionVerified','historyCompletenessProven'])assert.equal(r[k],false)});
test('rejects duplicate and unsafe IDs',()=>{for(const rows of [[row,row],[{...row,tranId:9007199254740992}],[{...row,tranId:null}]])assert.equal(reviewAccountRebates(rows,1000,2000).status,'BLOCKED')});
test('rejects unexpected asset, negative and lossy income, type and time',()=>{for(const patch of [{asset:'ASTER'},{income:'-1'},{income:0.1},{incomeType:'FUNDING_FEE'},{time:1000},{time:2001}])assert.equal(reviewAccountRebates([{...row,...patch}],1000,2000).status,'BLOCKED')});
test('empty input never proves history completeness',()=>{const r=reviewAccountRebates([],1000,2000);assert.equal(r.unallocatedCreditUsd,'0');assert.equal(r.historyCompletenessProven,false)});
