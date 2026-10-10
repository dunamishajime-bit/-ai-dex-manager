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
test("systemd must identify exact release-bound active runner and live PID",()=>{
 const unit="disdex-pengu-dual-ls-v2@"+sha+".service";
 assert.equal(parseV4SystemdShow(
  "Id="+unit+"\nActiveState=active\nSubState=running\nMainPID=1234\n",unit,now).mainPid,1234);
 assert.throws(()=>parseV4SystemdShow(
  "Id="+unit+"\nActiveState=inactive\nSubState=dead\nMainPID=0\n",unit,now),/NOT_RUNNING/);
 assert.throws(()=>parseV4SystemdShow(
  "Id="+unit+"\nActiveState=active\nSubState=running\nMainPID=12\n",unit.replace(sha,oldSha),now),/WRONG_SHA/);
});
