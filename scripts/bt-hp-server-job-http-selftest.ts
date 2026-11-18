import assert from "node:assert/strict";
import crypto from "node:crypto";
import {NextRequest} from "next/server";
import {issueOwnerSession} from "../lib/server/owner-session";
import {POST} from "../app/api/bt-verification/simulate/route";
import {validateReplay} from "../lib/bt-verification/replay";

async function main(){
 const secret=crypto.randomBytes(32).toString("base64url");
 const origin="http://localhost:3000";
 process.env.DISDEX_OWNER_SESSION_HMAC_KEY=secret;
 process.env.DISDEX_BT_ORIGIN=origin;
 delete process.env.DISDEX_BT_SANDBOX_JOBS_ENABLED;
 const token=issueOwnerSession({
   key:secret,subject:"bt481-test-subject",purpose:"USER",
   audience:"localhost:3000",ttlMs:60000
 });
 const cookie="disdex_owner_session="+token;
 const input={mode:"H48_23SYM_CANDIDATE_RESEARCH_ONLY",seed:1,scenario:"trend",costBps:10};
 const url=origin+"/api/bt-verification/simulate";
 const make=(body:unknown,headers:Record<string,string>={})=>
  new NextRequest(url,{method:"POST",headers:{"Content-Type":"application/json",
    Cookie:cookie,Origin:origin,...headers},body:JSON.stringify(body)});
 const anon=await POST(make(input,{Cookie:""}));
 assert.equal(anon.status,401);
 assert.match(anon.headers.get("cache-control")??"",/no-store/);
 const csrf=await POST(make(input,{Origin:"http://attack.invalid"}));
 assert.equal(csrf.status,403);
 const disabled=await POST(make(input));
 assert.equal(disabled.status,503,"Explicit job enable is required even for an authorized owner");
 assert.equal((await disabled.json() as {error:string}).error,"BT_SYNTHETIC_JOB_DISABLED_FAIL_CLOSED");
 delete process.env.DISDEX_BT_ORIGIN;
 assert.equal((await POST(make(input))).status,403,"Never infer allowed Origin from request Host");
 process.env.DISDEX_BT_ORIGIN=origin;
 process.env.DISDEX_BT_SANDBOX_JOBS_ENABLED="1";
 assert.equal((await POST(make({...input,mode:"STABLE4_FULL"}))).status,400,
   "No unauthorized full strategy native executor");
 assert.equal((await POST(make({...input,rootKey:"/tmp/secret"}))).status,400,"Extra parameters denied");
 assert.equal((await POST(make({...input,seed:1e20}))).status,400);
 assert.equal((await POST(make(input,{"Content-Type":"text/plain"}))).status,415);
 const forgedBody="x".repeat(5000);
 const tooLarge=await POST(new NextRequest(url,{method:"POST",
   headers:{Cookie:cookie,Origin:origin,"Content-Type":"application/json"},
   body:forgedBody}));
 assert.equal(tooLarge.status,400,"Bounded request size");
 const allowed=await POST(make(input));
 assert.equal(allowed.status,200,"Authorized owner research job computes only safe synthetic H48");
 const raw=await allowed.json() as {sourceMode:string;parity:string;replay:unknown};
 assert.equal(raw.sourceMode,"SYNTHETIC_H48_RESEARCH_ONLY");
 assert.equal(raw.parity,"NOT_PRODUCTION_OR_SEVEN_RUNNER_PARITY");
 assert.equal(validateReplay(raw.replay),true);
 const replay=raw.replay as {frames:Array<{events:string[]}>;mode:string;source:{kind:string}};
 assert.equal(replay.mode,"DEMO");assert.equal(replay.frames.length,2880);
 assert.equal(replay.source.kind,"SYNTHETIC_MULTI_ASSET_H48_CANDIDATE");
 assert.ok(replay.frames.some(f=>f.events.some(e=>e.startsWith("ENTRY HYPE_H48_RESEARCH"))));
 assert.ok(replay.frames.every(f=>f.events.every(e=>!e.startsWith("ENTRY V4"))));
 assert.match(allowed.headers.get("cache-control")??"",/no-store/);
 delete process.env.DISDEX_BT_SANDBOX_JOBS_ENABLED;
 console.log("PASS owner-auth H48-only research job HTTP: 401 anon, 403 CSRF, 503 disabled, 400 invalid, 200 valid (2880 model frames)");
}
main().catch(e=>{console.error(e);process.exitCode=1});
