import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,writeFile,rm,unlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createStable4NativeShadowLedger,appendStable4NativeShadowCandidate,completeStable4NativeShadowCandidate,markStable4NativeShadowUnresolved,completedStable4NativeShadowLabels,validateStable4NativeShadowLedger,Stable4NativeShadowStore} from "../lib/stable4-native-shadow-ledger";

const T=1800000000000,SHA="a".repeat(40),HASH="b".repeat(64);
const ref=(kind:string,sha256=HASH)=>({kind,ref:"normalized-source:"+kind,sha256});
function candidate(extra:any={}):any{return{nativeKey:"native-FET-1",sourceSha:SHA,strategy:"FET",symbol:"FETUSDT",side:"SHORT",route:"FET_NATIVE",logicalEntryTs:T,gross:.75,modelExpectedHoldHours:24,capturedAt:T+1,entryFeatures:{volumeRatio:2,return72h:.1},nativePolicy:{id:"FET_NATIVE",version:"v1",sourceSha:SHA,sourceDigestSha256:HASH,shortReturnConvention:"linear",roundTripCost:.003},evidenceCoverage:{from:T-3600000,through:T,observedAt:T+1,refs:[ref("ENTRY"),ref("POLICY")]},...extra};}
function result(extra:any={}):any{return{nativeKey:"native-FET-1",policyDigestSha256:HASH,entryTs:T,entryPrice:100,exitTs:T+1000,exitPrice:90,exitReason:"NATIVE_STOP",knownAt:T+2000,evidenceCoverage:{from:T,through:T+1000,observedAt:T+1500,refs:[ref("PRICE"),ref("POLICY")]},funding:{from:T,through:T+1000,observedAt:T+1500,refs:[ref("FUNDING")],rows:[{fundingTime:T,fundingRate:99,markPrice:100},{fundingTime:T+500,fundingRate:.01,markPrice:110},{fundingTime:T+1000,fundingRate:99,markPrice:100}]},...extra};}
const pending=()=>appendStable4NativeShadowCandidate(createStable4NativeShadowLedger("FET"),candidate());

test("native candidates persist before suppression without inventing an exit or a label",()=>{
 const value=pending();assert.equal(value.entries[0].status,"PENDING");assert.equal(value.entries[0].candidate.nativeKey,"native-FET-1");assert.deepEqual(completedStable4NativeShadowLabels(value,T+100000),[]);
 assert.ok(Object.isFrozen(value));assert.ok(Object.isFrozen(value.entries[0].candidate.entryFeatures));
});
test("exact candidate retry is idempotent and original entry fields cannot be rewritten",()=>{
 const value=pending();assert.deepEqual(appendStable4NativeShadowCandidate(value,candidate()),value);
 for(const change of [{gross:1},{route:"changed"},{sourceSha:"c".repeat(40)},{entryFeatures:{volumeRatio:3}},{modelExpectedHoldHours:48}])assert.throws(()=>appendStable4NativeShadowCandidate(value,candidate(change)),/CONFLICT/);
});
test("native completion uses the declared short convention and strictly exclusive funding events",()=>{
 const completed=completeStable4NativeShadowCandidate(pending(),"native-FET-1",result(),T+3000);
 const label=completedStable4NativeShadowLabels(completed,T+3000)[0];assert.ok(Math.abs(label.net30-.108)<1e-12);assert.equal(label.exitTs,T+1000);
 const reciprocal=appendStable4NativeShadowCandidate(createStable4NativeShadowLedger("FET"),candidate({nativePolicy:{...candidate().nativePolicy,shortReturnConvention:"reciprocal"}}));
 const r=completeStable4NativeShadowCandidate(reciprocal,"native-FET-1",result(),T+3000);
 assert.ok(Math.abs(completedStable4NativeShadowLabels(r,T+3000)[0].net30-(100/90-1+.011-.003))<1e-12);
 const long=appendStable4NativeShadowCandidate(createStable4NativeShadowLedger("FET"),candidate({side:"LONG"}));
 assert.ok(Math.abs(completedStable4NativeShadowLabels(completeStable4NativeShadowCandidate(long,"native-FET-1",result(),T+3000),T+3000)[0].net30-(-.114))<1e-12);
});
test("only causally known completed outcomes enter continuation labels",()=>{
 const completed=completeStable4NativeShadowCandidate(pending(),"native-FET-1",result(),T+3000);
 assert.deepEqual(completedStable4NativeShadowLabels(completed,T+2000),[]);
 assert.equal(completedStable4NativeShadowLabels(completed,T+2001).length,1);
 for(const r of [result({exitTs:T+3000}),result({knownAt:T+4000}),result({knownAt:T+1000}),result({entryTs:T-1})])assert.throws(()=>completeStable4NativeShadowCandidate(pending(),"native-FET-1",r,T+3000));
});
test("planned deadlines, callbacks and missing or incomplete source coverage cannot manufacture a label",()=>{
 for(const changes of [{exitPrice:undefined},{verify:()=>true},{policyDigestSha256:"c".repeat(64)},{evidenceCoverage:{...result().evidenceCoverage,through:T+999}},{evidenceCoverage:{...result().evidenceCoverage,refs:[ref("PRICE")]}},{funding:{...result().funding,through:T+999}},{funding:{...result().funding,refs:[]}}])assert.throws(()=>completeStable4NativeShadowCandidate(pending(),"native-FET-1",result(changes),T+3000));
 assert.throws(()=>completeStable4NativeShadowCandidate(pending(),"missing",result(),T+3000));
});
test("unresolved evidence is retained without a training label and can complete later",()=>{
 const unresolved=markStable4NativeShadowUnresolved(pending(),"native-FET-1",{reason:"EVIDENCE_GAP",observedAt:T+1000,evidenceCoverage:{from:T,through:T+500,observedAt:T+1000,refs:[ref("PRICE")]}},T+2000);
 assert.equal(unresolved.entries[0].status,"UNRESOLVED");assert.equal(unresolved.entries[0].unresolved.length,1);assert.deepEqual(completedStable4NativeShadowLabels(unresolved,T+3000),[]);
 const completed=completeStable4NativeShadowCandidate(unresolved,"native-FET-1",result(),T+3000);assert.equal(completed.entries[0].unresolved.length,1);
 assert.throws(()=>markStable4NativeShadowUnresolved(completed,"native-FET-1",{reason:"EVIDENCE_GAP",observedAt:T+4000,evidenceCoverage:result().evidenceCoverage},T+5000));
});
test("completed evidence and labels are immutable and cannot be replaced by new prices",()=>{
 const completed=completeStable4NativeShadowCandidate(pending(),"native-FET-1",result(),T+3000);
 assert.deepEqual(completeStable4NativeShadowCandidate(completed,"native-FET-1",result(),T+4000),completed);
 assert.throws(()=>completeStable4NativeShadowCandidate(completed,"native-FET-1",result({exitPrice:91}),T+4000),/CONFLICT/);
 const corrupt=structuredClone(completed);corrupt.entries[0].completion!.label.net30=99;assert.throws(()=>validateStable4NativeShadowLedger(corrupt));
});
test("strict fields, sparse arrays, numeric coercions, lineage and feature leakage reject",()=>{
 for(const changes of [{gross:true},{logicalEntryTs:"1800000000000"},{entryFeatures:{exitReturn:1}},{entryFeatures:{volumeRatio:NaN}},{sourceSha:"bad"},{strategy:"UNKNOWN"},{extra:1},{sourceSha:undefined},{nativePolicy:{...candidate().nativePolicy,roundTripCost:0}}])assert.throws(()=>appendStable4NativeShadowCandidate(createStable4NativeShadowLedger("FET"),candidate(changes)));
 assert.throws(()=>validateStable4NativeShadowLedger({schema:"disdex-stable4-native-shadow/v1",strategy:"FET",revision:0,entries:new Array(1)}));
 const dup=result();dup.funding.rows.push({...dup.funding.rows[1]});assert.throws(()=>completeStable4NativeShadowCandidate(pending(),"native-FET-1",dup,T+3000));
});
async function fixture(run:(path:string)=>Promise<void>){const dir=await mkdtemp(join(tmpdir(),"stable4-native-shadow-"));try{await run(join(dir,"ledger.json"));}finally{await rm(dir,{recursive:true,force:true});}}
test("durable reads never auto-create empty learning state, explicit capture precedes completion commit",async()=>fixture(async path=>{
 const store=new Stable4NativeShadowStore(path);await assert.rejects(store.read(),/MISSING/);
 await store.initialize(createStable4NativeShadowLedger("FET"));const first=await store.snapshot();
 await store.commit(first,appendStable4NativeShadowCandidate(first.ledger,candidate()));
 const second=await store.snapshot();assert.equal(second.ledger.revision,1);
 await store.commit(second,completeStable4NativeShadowCandidate(second.ledger,"native-FET-1",result(),T+3000));
 assert.equal((await store.read()).entries[0].status,"COMPLETED");
 await assert.rejects(store.initialize(createStable4NativeShadowLedger("FET")));
}));
test("byte CAS, stale revisions, candidate rewrites, entry removal and completed rewrites preserve current bytes",async()=>fixture(async path=>{
 const store=new Stable4NativeShadowStore(path);await store.initialize(pending());const prior=await store.snapshot();
 await writeFile(path,(await readFile(path,"utf8"))+" ");const external=await readFile(path,"utf8");
 await assert.rejects(store.commit(prior,prior.ledger),/CAS/);assert.equal(await readFile(path,"utf8"),external);
 const fresh=await store.snapshot();await assert.rejects(store.commit(fresh,{...fresh.ledger,entries:[]}));
 await store.commit(fresh,completeStable4NativeShadowCandidate(fresh.ledger,"native-FET-1",result(),T+3000));
 await assert.rejects(store.commit(fresh,fresh.ledger),/CAS/);
 const completed=await store.snapshot(),changed=structuredClone(completed.ledger);changed.entries[0].candidate.gross=2;await assert.rejects(store.commit(completed,changed));
}));
test("existing writer guard is never removed or stolen",async()=>fixture(async path=>{
 const store=new Stable4NativeShadowStore(path);await store.initialize(pending());const snap=await store.snapshot();await writeFile(path+".writer","another writer");
 await assert.rejects(store.commit(snap,snap.ledger),/WRITER/);assert.equal(await readFile(path+".writer","utf8"),"another writer");
}));
test("policy references and all identities reject coercion and mismatched policy digests",()=>{
 const c=candidate();c.evidenceCoverage.refs[1].sha256="c".repeat(64);assert.throws(()=>appendStable4NativeShadowCandidate(createStable4NativeShadowLedger("FET"),c));
 const a=candidate();a.evidenceCoverage.refs[0].sha256=[HASH];assert.throws(()=>appendStable4NativeShadowCandidate(createStable4NativeShadowLedger("FET"),a));
 for(const changes of [{sourceSha:[SHA]},{symbol:["FETUSDT"]}])assert.throws(()=>appendStable4NativeShadowCandidate(createStable4NativeShadowLedger("FET"),candidate(changes)));
 const r=result();r.evidenceCoverage.refs[1].sha256="c".repeat(64);assert.throws(()=>completeStable4NativeShadowCandidate(pending(),"native-FET-1",r,T+3000));
});
test("completion cannot erase previously recorded unresolved observations",async()=>fixture(async path=>{
 const u=markStable4NativeShadowUnresolved(pending(),"native-FET-1",{reason:"GAP",observedAt:T+2000,evidenceCoverage:result().evidenceCoverage},T+3000),store=new Stable4NativeShadowStore(path);
 await store.initialize(u);const snap=await store.snapshot(),done=structuredClone(completeStable4NativeShadowCandidate(u,"native-FET-1",result(),T+3000));delete done.entries[0].unresolved;
 await assert.rejects(store.commit(snap,done),/HISTORY_CONFLICT/);
}));
test("a replaced writer file is preserved and blocks the ledger commit",async()=>fixture(async path=>{
 const store=new Stable4NativeShadowStore(path);await store.initialize(pending());const snap=await store.snapshot(),read=store.snapshot.bind(store);let replaced=false;
 store.snapshot=async()=>{if(!replaced){replaced=true;await unlink(path+".writer");await writeFile(path+".writer","replacement");}return read();};
 await assert.rejects(store.commit(snap,snap.ledger),/WRITER/);assert.equal(await readFile(path+".writer","utf8"),"replacement");assert.equal((await read()).ledger.revision,0);
}));
test("concurrent stale transactions serialize and one rejects rather than losing an append",async()=>fixture(async path=>{
 const a=new Stable4NativeShadowStore(path),b=new Stable4NativeShadowStore(path);await a.initialize(createStable4NativeShadowLedger("FET"));const snap=await a.snapshot();
 const results=await Promise.allSettled([a.commit(snap,appendStable4NativeShadowCandidate(snap.ledger,candidate())),b.commit(snap,appendStable4NativeShadowCandidate(snap.ledger,candidate({nativeKey:"native-two"})))]);
 assert.equal(results.filter(x=>x.status==="fulfilled").length,1);assert.equal((await a.read()).entries.length,1);
}));
