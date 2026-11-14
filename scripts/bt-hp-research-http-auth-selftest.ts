import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {NextRequest} from "next/server";
import {issueOwnerSession,OWNER_SESSION_COOKIE} from "../lib/server/owner-session";
import {GET as list} from "../app/api/bt-verification/research/route";
import {GET as load} from "../app/api/bt-verification/research/[id]/route";
async function main(){
 const root=process.env.DISDEX_BT_RESEARCH_LIBRARY_DIR;
 assert.ok(root,"Research library path is required to run the selftest");
 const key=randomBytes(48).toString("base64url");
 process.env.DISDEX_OWNER_SESSION_HMAC_KEY=key;
 const base="https://bt.example.test/api/bt-verification/research";
 const unauth=new NextRequest(base,{headers:{"host":"bt.example.test"}});
 assert.equal((await list(unauth)).status,401,"Anon clients must not list research data");
 assert.equal((await load(unauth,{params:Promise.resolve({id:"ANY_10BPS_REPLAY.json"})})).status,401,
   "Anon clients must not fetch research data");
 const session=issueOwnerSession({key,subject:"bt-readonly-selftest",purpose:"USER",
   audience:"bt.example.test",ttlMs:15*60*1000});
 const headers={"host":"bt.example.test","cookie":OWNER_SESSION_COOKIE+"="+session};
 const authed=new NextRequest(base,{headers});
 const listed=await list(authed);
 assert.equal(listed.status,200);
 assert.equal(listed.headers.get("Cache-Control"),"private, no-store, max-age=0");
 const meta=await listed.json();
 assert.equal(meta.items.length,4);
 assert.ok(meta.items.every((x:{sourceMode:string})=>x.sourceMode==="RESEARCH_MODEL_NOT_VENUE_EXECUTION"));
 const item=meta.items[0];
 const loaded=await load(new NextRequest(base+"/"+item.id,{headers}),{params:Promise.resolve({id:item.id})});
 assert.equal(loaded.status,200);
 assert.equal(loaded.headers.get("Cache-Control"),"private, no-store, max-age=0");
 const body=await loaded.json();
 assert.equal(body.entry.sha256,item.sha256);
 assert.equal(body.replay.frames.length,item.frames);
 assert.equal(body.replay.mode,"EXTERNAL");
 assert.ok(body.replay.frames.some((x:{gross?:unknown})=>x.gross),
   "Protected model should show as-of gross snapshots");
 const malicious=await load(new NextRequest(base+"/wrong",{headers}),{params:Promise.resolve({id:"../TRAVERSAL_REPLAY.json"})});
 assert.equal(malicious.status,400);
 const old=process.env.DISDEX_BT_RESEARCH_LIBRARY_DIR;
 try{
   delete process.env.DISDEX_BT_RESEARCH_LIBRARY_DIR;
   assert.equal((await list(authed)).status,503,"Unconfigured research path must fail closed");
   assert.equal((await load(new NextRequest(base+"/"+item.id,{headers}),{params:Promise.resolve({id:item.id})})).status,503);
 }finally{process.env.DISDEX_BT_RESEARCH_LIBRARY_DIR=old}
 console.log(JSON.stringify({status:"PASS",auth:"OWNER_SESSION_HMAC",unauthed:401,
  researchCases:meta.items.length,verifiedReplay:item.id,mode:body.replay.mode,
  privateNoStore:true,pathTraversalRejected:true,envMissingFailClosed:true}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
