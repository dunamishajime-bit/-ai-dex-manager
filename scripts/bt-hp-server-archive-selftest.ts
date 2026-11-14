import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {NextRequest} from "next/server";
import {issueOwnerSession} from "../lib/server/owner-session";
import {saveOwnerRun,listOwnerRuns,readOwnerRun,deleteOwnerRun} from "../lib/server/bt-replay-store";
import {GET as LIST,POST} from "../app/api/bt-verification/runs/route";
import {GET as READ,DELETE as DELETE} from "../app/api/bt-verification/runs/[id]/route";
import type {Replay} from "../lib/bt-verification/replay";

async function main(){
 const base=await fs.mkdtemp(path.join(tmpdir(),"bt481-owner-archive-test-"));
 try {
  process.env.DISDEX_BT_ARCHIVE_DIR=base;
  const secret=crypto.randomBytes(32).toString("base64url");
  process.env.DISDEX_OWNER_SESSION_HMAC_KEY=secret;
  process.env.DISDEX_BT_ORIGIN="http://localhost:3000";
  const subject="test-owner-subject-a";
  const token=issueOwnerSession({key:secret,subject,purpose:"USER",audience:"localhost:3000",ttlMs:60_000});
  const cookie="disdex_owner_session="+token;
  const baseUrl="http://localhost:3000/api/bt-verification/runs";
  const data:Replay={schema:"disdex-bt-portfolio-v1",mode:"DEMO",engineSha:"UNITTEST_ONLY",seed:100,
    limits:{total:3.5,crypto:3.0,stock:1.5},
    frames:[{timestamp:"2025-10-01T00:00:00Z",btc:110000,equity:10000,realized:0,
      positions:[],events:[],gross:{totalX:0,cryptoX:0,stockX:0,source:"bt_equity_snapshot"}}]};
  const a=await saveOwnerRun(subject,"first",data);
  assert.equal((await readOwnerRun(subject,a.id))?.data.frames.length,1);
  assert.equal((await listOwnerRuns("other-owner")).length,0,"Owner isolation");
  assert.equal(await readOwnerRun("other-owner",a.id),null);
  assert.equal(await deleteOwnerRun("other-owner",a.id),false);
  assert.equal(await deleteOwnerRun(subject,a.id),true);

  const unauthorized=await POST(new NextRequest(baseUrl,{method:"POST",headers:{origin:"http://localhost:3000","Content-Type":"application/json"},
    body:JSON.stringify({name:"bad",replay:data})}));
  assert.equal(unauthorized.status,401,"No signed owner cookie");

  const csrf=await POST(new NextRequest(baseUrl,{method:"POST",headers:{Cookie:cookie,origin:"http://untrusted.invalid","Content-Type":"application/json"},
    body:JSON.stringify({name:"bad",replay:data})}));
  assert.equal(csrf.status,403,"Cross-origin write forbidden");

  delete process.env.DISDEX_BT_ORIGIN;
  const noConfiguredOrigin=await POST(new NextRequest(baseUrl,{method:"POST",
    headers:{Cookie:cookie,origin:"http://localhost:3000","Content-Type":"application/json"},
    body:JSON.stringify({name:"bad",replay:data})}));
  assert.equal(noConfiguredOrigin.status,403,"Write denied when operator origin not configured");
  process.env.DISDEX_BT_ORIGIN="http://localhost:3000";

  const good=await POST(new NextRequest(baseUrl,{method:"POST",
    headers:{Cookie:cookie,origin:"http://localhost:3000","Content-Type":"application/json"},
    body:JSON.stringify({name:"stored replay",replay:data})}));
  if(good.status!==201)throw new Error("Unexpected POST status "+good.status+": "+await good.text());
  const result=await good.json() as {item:{id:string}};
  const req=(url:string,method="GET",origin?:string)=>new NextRequest(url,{
    method,headers:{Cookie:cookie,...(origin?{Origin:origin}:{})}});
  const list=await LIST(req(baseUrl));
  assert.equal(list.status,200);
  assert.equal((await list.json() as {items:unknown[]}).items.length,1);
  const item=await READ(req(baseUrl+"/"+result.item.id),{params:Promise.resolve({id:result.item.id})});
  assert.equal(item.status,200);
  assert.equal((await item.json() as {data:Replay}).data.schema,"disdex-bt-portfolio-v1");
  const traversal=await READ(req(baseUrl+"/../../../etc/passwd"),{params:Promise.resolve({id:"../../.."})});
  assert.equal(traversal.status,400);
  const denyDelete=await DELETE(req(baseUrl+"/"+result.item.id,"DELETE","http://evil.invalid"),
    {params:Promise.resolve({id:result.item.id})});
  assert.equal(denyDelete.status,403);
  const deleted=await DELETE(req(baseUrl+"/"+result.item.id,"DELETE","http://localhost:3000"),
    {params:Promise.resolve({id:result.item.id})});
  assert.equal(deleted.status,204);
  assert.equal((await listOwnerRuns(subject)).length,0);
  const testHash=await saveOwnerRun(subject,"tamper-check",data);
  const ownerDir=crypto.createHash("sha256").update("disdex-bt-store-v1:"+subject).digest("hex");
  await fs.appendFile(path.join(base,ownerDir,testHash.id+".json")," ");
  await assert.rejects(readOwnerRun(subject,testHash.id),/BT_REPLAY_HASH_MISMATCH/);
  await deleteOwnerRun(subject,testHash.id);
  const otherToken=issueOwnerSession({key:secret,subject:"other-owner",purpose:"USER",audience:"localhost:3000",ttlMs:60_000});
  const own=await saveOwnerRun(subject,"cross-owner",data);
  const otherReq=new NextRequest(baseUrl+"/"+own.id,{headers:{Cookie:"disdex_owner_session="+otherToken}});
  const otherRes=await READ(otherReq,{params:Promise.resolve({id:own.id})});
  assert.equal(otherRes.status,404,"Signed other owner must not see replay");
  await deleteOwnerRun(subject,own.id);
  console.log(JSON.stringify({status:"PASS",tests:15,storageRoot:"ephemeral test only"}));
 }finally{
  await fs.rm(base,{recursive:true,force:true});
  delete process.env.DISDEX_BT_ARCHIVE_DIR;
  delete process.env.DISDEX_BT_ORIGIN;
  delete process.env.DISDEX_OWNER_SESSION_HMAC_KEY;
 }
}
main().catch(e=>{console.error(e);process.exitCode=1});
