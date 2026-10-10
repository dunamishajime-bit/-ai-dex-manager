import test from "node:test";
import assert from "node:assert/strict";
import {v4PeerOwners,type V4PeerKind,type V4PeerSource} from "../lib/v12-v4-peer-state-owners";
import {parseV4SystemdShow} from "../lib/v12-v4-peer-service-attestation";
const sha="a".repeat(40),oldSha="b".repeat(40),now=Date.now();
const kinds:V4PeerKind[]=["V12","PENGU","Q102","V52","FET","HYPE_LONG","IDLE","RESIDUAL"];
function sources():V4PeerSource[]{
 return kinds.map(kind=>{
  const runtime=kind==="V12"?oldSha:sha;
  const raw:any={updatedAt:now-40*60000,runtimeCommitSha:runtime};
  if(kind==="V12")Object.assign(raw,{schema:"v12-x1-all-runner-state/v2",
   strategyId:"V12_X1.00_ALL",mode:"LIVE"});
  if(kind==="PENGU")Object.assign(raw,{version:2,strategyId:"PENGU_DUAL_LS_V2_FINAL",mode:"LIVE"});
  if(kind==="V52")raw.positions={};
  if(kind==="FET")Object.assign(raw,{schema:"fet-brk48-residual-state/v1",strategyId:"FET_BRK48_RESIDUAL"});
  if(kind==="Q102")Object.assign(raw,{version:1,strategyId:"QUALITY102_CAUSAL_V1"});
  if(kind==="HYPE_LONG")Object.assign(raw,{schema:"disdex-hype-zec-long/v1",mode:"LIVE"});
  if(kind==="IDLE")raw.positions=[];
  if(kind==="RESIDUAL")raw.schema="disdex-idle-residual-long-state/v1";
  const retired=kind==="V12";
  return {kind,programSha:runtime,raw,service:{
   unit:retired?"disdex-v12-x1-all@*.service":"disdex-"+kind.toLowerCase()+"@"+sha+".service",
   active:!retired,retiredV12:retired,observedAt:now,mainPid:retired?0:1234
  }};
 });
}
test("stale flat peer state is accepted only alongside current release-bound live systemd observation",()=>{
 const v=sources();
 assert.deepEqual(v4PeerOwners(v,sha,now),[]);
 const noService=sources();
 noService[2].service=undefined;
 assert.throws(()=>v4PeerOwners(noService,sha,now),/STALE_PEER_OWNER_SNAPSHOT/);
 const expired=sources();expired[3].service!.observedAt=now-30_000;
 assert.throws(()=>v4PeerOwners(expired,sha,now),/STALE_PEER_OWNER_SNAPSHOT/);
 const dead=sources();dead[3].service!.active=false;
 assert.throws(()=>v4PeerOwners(dead,sha,now),/STALE_PEER_OWNER_SNAPSHOT/);
});
test("retired legacy V12 must be flat and cannot conceal pending work",()=>{
 const okay=sources();assert.deepEqual(v4PeerOwners(okay,sha,now),[]);
 const positioned=sources();positioned[0].raw.activePositions=[{symbol:"ADAUSDT",side:"LONG",quantity:3}];
 assert.throws(()=>v4PeerOwners(positioned,sha,now),/RETIRED_V12_NOT_SIGNED_FLAT/);
 const pending=sources();pending[0].raw.pending={phase:"entry"};
 assert.throws(()=>v4PeerOwners(pending,sha,now),/RETIRED_V12_NOT_SIGNED_FLAT/);
 const review=sources();review[5].raw.manualReview="unknown";
 assert.throws(()=>v4PeerOwners(review,sha,now),/PEER_PENDING_OR_MANUAL_REVIEW/);
});
test("Production canary may attest each non-V12 peer at its own exact active release; service-derived SHA is accepted only when state omits its own SHA",()=>{
 const v=sources();
 const peerShas=["c","d","e","f","1","2","3"].map(x=>x.repeat(40));
 for(let i=1;i<v.length;i++){
  const peerSha=peerShas[i-1];
  v[i].programSha=peerSha;
  (v[i].raw as any).runtimeCommitSha=peerSha;
  v[i].service!.unit=v[i].service!.unit.replace(sha,peerSha);
 }
 assert.throws(()=>v4PeerOwners(v,sha,now),/PEER_PROGRAM_LINEAGE_MISMATCH/);
 assert.deepEqual(v4PeerOwners(v,sha,now,"ATTEST_EACH_PEER"),[]);
 const serviceDerived=sources();
 delete (serviceDerived[1].raw as any).runtimeCommitSha;
 delete (serviceDerived[1].raw as any).runtimeSha;
 serviceDerived[1].programSha="c".repeat(40);
 (serviceDerived[1] as any).programShaSource="SYSTEMD";
 serviceDerived[1].service!.unit=serviceDerived[1].service!.unit.replace(sha,"c".repeat(40));
 assert.deepEqual(v4PeerOwners(serviceDerived,sha,now,"ATTEST_EACH_PEER"),[]);
 const contradictory=structuredClone(serviceDerived);
 (contradictory[1].raw as any).runtimeCommitSha="d".repeat(40);
 assert.throws(()=>v4PeerOwners(contradictory,sha,now,"ATTEST_EACH_PEER"),/PEER_PROGRAM_LINEAGE_MISMATCH/);

 const wrongService=sources();
 wrongService[1].programSha="c".repeat(40);
 (wrongService[1].raw as any).runtimeCommitSha="c".repeat(40);
 assert.throws(()=>v4PeerOwners(wrongService,sha,now,"ATTEST_EACH_PEER"),/STALE_PEER_OWNER_SNAPSHOT/);
 const wrongState=sources();
 wrongState[1].programSha="c".repeat(40);
 wrongState[1].service!.unit=wrongState[1].service!.unit.replace(sha,"c".repeat(40));
 assert.throws(()=>v4PeerOwners(wrongState,sha,now,"ATTEST_EACH_PEER"),/PEER_PROGRAM_LINEAGE_MISMATCH/);
});

test("systemd must identify exact release-bound active runner and live PID",()=>{
 const unit="disdex-pengu-dual-ls-v2@"+sha+".service";
 const release="/home/deploy/disdex-trading/releases/"+sha;
 const fields="WorkingDirectory="+release+"\nExecStart={ path="+release+"/runner; argv[]="+release+"/runner --daemon }\n";
 assert.equal(parseV4SystemdShow(
  "Id="+unit+"\nActiveState=active\nSubState=running\nMainPID=1234\n"+fields,unit,now).mainPid,1234);
 assert.throws(()=>parseV4SystemdShow(
  "Id="+unit+"\nActiveState=inactive\nSubState=dead\nMainPID=0\n"+fields,unit,now),/NOT_RUNNING/);
 assert.throws(()=>parseV4SystemdShow(
  "Id="+unit+"\nActiveState=active\nSubState=running\nMainPID=12\n"+fields,unit.replace(sha,oldSha),now),/WRONG_SHA/);
 assert.throws(()=>parseV4SystemdShow(
  "Id="+unit+"\nActiveState=active\nSubState=running\nMainPID=12\n"+
  "WorkingDirectory=/home/deploy/disdex-trading/releases/"+oldSha+
  "\nExecStart={ path=/home/deploy/disdex-trading/releases/"+oldSha+"/runner }\n",
  unit,now),/EXECUTABLE_RELEASE_SHA_MISMATCH/);

});
