import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyPendingExposure,projectSignedFlatGross,projectV4Decision,parseStrictCaps} from '../lib/disdex-health-observability.mjs';
const now=2000000,sha='a'.repeat(40),sdk='b'.repeat(40),hash='c'.repeat(64);
function pending(entries=[]){return {schema:'disdex-pending-exposure/v1',accountScope:'ASTER_FUTURES',updatedAt:now-100,entries};}
function report(){return {status:'PENDING_MAINTENANCE_RECONCILED',sourceSha:sdk,scope:'PENDING_RECONCILE_ONLY',ordersEnabled:false,authorizationMethod:'ROOT_COMMITTED_NO_ORDER_MAINTENANCE',completedAt:now-5,result:{status:'PENDING_READONLY_RECONCILE_APPLIED',verifiedAt:now-10,ownershipMode:'FLAT_NO_OPEN_ORDERS',positionCount:0,openOrderCount:0,afterHash:hash,ordersSent:0,cancelsSent:0,positionChangesSent:0}};}
test('pending health rejects missing, coerced, negative, nonfinite, future, stale and unknown reservations',()=>{
 const entry={reservationId:'one',status:'PENDING',sleeve:'CRYPTO',gross:1,notionalUsd:100,updatedAt:now-10};
 assert.equal(classifyPendingExposure(pending([entry]),now).totalGross,1);
 for(const [key,value]of [['gross',null],['gross','1'],['gross',NaN],['gross',Infinity],['gross',-1],['notionalUsd',null],['notionalUsd',undefined],['updatedAt',now+1],['updatedAt',now-300001],['status','TYPO'],['sleeve','OTHER']]){
  assert.equal(classifyPendingExposure(pending([{...entry,[key]:value}]),now).status,'BLOCKED',key+':'+value);
 }
 assert.equal(classifyPendingExposure({...pending(),updatedAt:now+1},now).status,'BLOCKED');
 assert.equal(classifyPendingExposure(pending([{...entry,status:'UNKNOWN'}]),now).status,'BLOCKED');
 const old=pending([{...entry,status:'RELEASED',updatedAt:now-900000}]);old.updatedAt=now-900000;
 const terminal=classifyPendingExposure(old,now);assert.equal(terminal.status,'HEALTHY');assert.equal(terminal.activeCount,0);assert.equal(terminal.sourceFresh,false);
 assert.equal(classifyPendingExposure({...old,entries:[{...entry,updatedAt:now-900000}]},now).status,'BLOCKED');
});
test('flat Gross comes only from current genuine no-order maintenance proof and unchanged pending bytes',()=>{
 const caps={cryptoGross:3,stockGross:4,totalGross:4.25,stockSlotGross:2};const input={report:report(),sdkSha:sdk,pending:classifyPendingExposure(pending(),now),pendingDigest:hash,caps,now};
 const r=projectSignedFlatGross(input);assert.equal(r.status,'HEALTHY');assert.equal(r.cryptoGross,0);assert.equal(r.stockGross,0);assert.equal(r.availableCryptoGross,3);assert.equal(r.availableStockGross,4);assert.equal(r.authorizesTrading,false);
 for(const change of [{sourceSha:sha},{ordersEnabled:true},{completedAt:now+1},{authorizationMethod:'FAKE'}])assert.equal(projectSignedFlatGross({...input,report:{...input.report,...change}}).status,'UNAVAILABLE');
 for(const change of [{positionCount:1},{openOrderCount:1},{verifiedAt:now-120001},{afterHash:'d'.repeat(64)},{ordersSent:1}])assert.equal(projectSignedFlatGross({...input,report:{...input.report,result:{...input.report.result,...change}}}).status,'UNAVAILABLE');
 assert.equal(projectSignedFlatGross({...input,pending:{...input.pending,status:'BLOCKED'}}).status,'UNAVAILABLE');
});
test('public Gross caps are parsed from the actual immutable V52 literal contract without execution or defaults',()=>{
 const text='class StrictPortfolioCaps:\n    stock_gross: float = 4.00\n    stock_slot_gross: float = 2.00\n    crypto_gross: float = 3.00\n    total_gross: float = 4.25\n\nSTRICT_CAPS = StrictPortfolioCaps()';
 assert.deepEqual(parseStrictCaps(text),{cryptoGross:3,stockGross:4,totalGross:4.25,stockSlotGross:2});
 assert.equal(parseStrictCaps(text.replace('4.25','float("inf")')),null);assert.equal(parseStrictCaps(text.replace('3.00','-3.00')),null);
});
test('V4 observed rankings remain explicitly ineligible and bind to the real tick and SHA',()=>{
 const row={schema:'disdex-v12-v4-gate-telemetry/v1',runtimeSha:sha,activeRunnerSha:sha,lastTickAt:now-10,updatedAt:now-10,stale:false,telemetryFresh:true,symbolCount:1,symbols:[{symbol:'BTCUSDT',nativeSide:'LONG',nativeScore:0.4,sourceEligible:false,sourceReason:'VOLUME_RATIO_BELOW_MINIMUM',routeGate:{state:'NOT_EVALUATED',routes:[]}}]};
 const input={row,sha,lastTickAt:now-10,now};let r=projectV4Decision(input);assert.equal(r.status,'OBSERVED');assert.equal(r.items[0].eligible,false);assert.equal(r.items[0].reason,'VOLUME_RATIO_BELOW_MINIMUM');assert.equal(r.routesEvaluated,0);
 for(const delta of [{runtimeSha:sdk},{lastTickAt:now-20},{updatedAt:now+1},{stale:true}])assert.equal(projectV4Decision({...input,row:{...row,...delta}}).status,'UNAVAILABLE');
});
