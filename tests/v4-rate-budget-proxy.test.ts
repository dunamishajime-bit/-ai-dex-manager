import assert from "node:assert/strict";
import test from "node:test";
import { createConnection } from "node:net";
import {
  executeV4BudgetProxyRequest,
  validateV4BudgetProxyRequest,
  validateV4BudgetProxyResponse,
  validateV4BudgetSocketPath,
} from "../lib/disdex-v4-rate-budget-proxy";
import { createV4BudgetBrokerServer } from "../lib/disdex-v4-rate-budget-server";
import { validateV4BudgetBrokerRuntime } from "../lib/disdex-v4-rate-budget-runtime";

const sha="a".repeat(40);
const schema="disdex-v4-budget-proxy/v1";

test("broker runtime requires an immutable release and deploy-owned socket directory", () => {
  const root=`/home/deploy/disdex-trading/releases/${sha}`;
  const valid={sha,cwd:root,releaseIsDirectory:true,releaseIsSymlink:false,releaseUid:0,releaseMode:0o555,
    markerIsFile:true,markerIsSymlink:false,markerUid:0,markerMode:0o444,markerSha:sha,
    socketDirectoryIsDirectory:true,socketDirectoryIsSymlink:false,socketDirectoryUid:1000,
    socketDirectoryGid:1000,socketDirectoryMode:0o750,uid:1000,gid:1000,deployUid:1000,deployGid:1000,
    proxyEnvironmentPresent:false};
  assert.doesNotThrow(()=>validateV4BudgetBrokerRuntime(valid));
  for(const bad of [{releaseUid:1000},{releaseMode:0o755},{markerMode:0o644},{markerSha:"b".repeat(40)},
    {socketDirectoryIsSymlink:true},{socketDirectoryUid:0},{socketDirectoryMode:0o777},
    {uid:0},{cwd:"/tmp"},{proxyEnvironmentPresent:true}]) {
    assert.throws(()=>validateV4BudgetBrokerRuntime({...valid,...bad}),/V4_BUDGET_BROKER_RUNTIME/);
  }
});

test("broker accepts only bounded read priorities and a SHA-specific socket", () => {
  assert.equal(validateV4BudgetSocketPath(sha,`/run/disdex-v4-budget-${sha}/budget.sock`),true);
  assert.throws(()=>validateV4BudgetSocketPath(sha,"/tmp/budget.sock"),/SOCKET_PATH/);
  assert.doesNotThrow(()=>validateV4BudgetProxyRequest({schema,operation:"reserve",weight:5,priority:"MARKET_DATA"}));
  for (const request of [
    {schema,operation:"reserve",weight:0,priority:"MARKET_DATA"},
    {schema,operation:"reserve",weight:101,priority:"MARKET_DATA"},
    {schema,operation:"reserve",weight:1,priority:"NEW_EXPOSURE"},
    {schema,operation:"reserve",weight:1,priority:"PROTECTIVE"},
    {schema,operation:"reserve",weight:1,priority:"RISK_READ",path:"/tmp/other"},
    {schema,operation:"defer",status:200,cooldownMs:0},
  ]) assert.throws(()=>validateV4BudgetProxyRequest(request),/V4_BUDGET_PROXY_REQUEST/);
});

test("broker delegates reads to the shared budget without shortening cooldown", async () => {
  const calls:any[]=[];
  const backend={
    reserve:async (weight:number,priority:string)=>{calls.push({weight,priority});return {waitMs:37};},
    defer:async (status:number,cooldownMs:number)=>{calls.push({status,cooldownMs});return {cooldownUntil:12345};},
  };
  assert.deepEqual(await executeV4BudgetProxyRequest({schema,operation:"reserve",weight:5,priority:"MARKET_DATA"},backend),{ok:true,waitMs:37});
  assert.deepEqual(await executeV4BudgetProxyRequest({schema,operation:"defer",status:429,cooldownMs:1},backend),{ok:true,cooldownUntil:12345});
  assert.deepEqual(await executeV4BudgetProxyRequest({schema,operation:"defer",status:418,cooldownMs:300000},backend),{ok:true,cooldownUntil:12345});
  assert.deepEqual(calls,[{weight:5,priority:"MARKET_DATA"},{status:429,cooldownMs:60000},{status:418,cooldownMs:300000}]);
});

test("broker backend failures propagate without granting a slot", async () => {
  const backend={reserve:async()=>{throw new Error("ASTER_GLOBAL_RATE_BUDGET_SATURATED");},defer:async()=>({cooldownUntil:1})};
  await assert.rejects(()=>executeV4BudgetProxyRequest({schema,operation:"reserve",weight:1,priority:"RISK_READ"},backend),/SATURATED/);
});

test("client rejects malformed broker replies instead of bypassing the shared budget", () => {
  const reserve={schema,operation:"reserve",weight:1,priority:"RISK_READ"} as const;
  assert.deepEqual(validateV4BudgetProxyResponse(reserve,{ok:true,waitMs:10}),{ok:true,waitMs:10});
  for(const response of [{ok:false},{ok:true},{ok:true,waitMs:-1},{ok:true,waitMs:30001},
    {ok:true,waitMs:0,extra:true},{ok:true,waitMs:"0"}]) {
    assert.throws(()=>validateV4BudgetProxyResponse(reserve,response),/RESPONSE_INVALID/);
  }
});

test("broker handles concurrent read reservations and rejects unsupported operations", async () => {
  let reservations=0;
  const server=createV4BudgetBrokerServer({
    reserve:async()=>{reservations+=1;return {waitMs:0};},
    defer:async()=>({cooldownUntil:Date.now()+60000}),
  });
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
  const address=server.address();
  assert.ok(address && typeof address!=="string");
  const request=(value:unknown)=>new Promise<any>((resolve,reject)=>{
    const socket=createConnection({host:"127.0.0.1",port:address.port});let raw="";
    socket.setEncoding("utf8");socket.once("error",reject);
    socket.on("data",chunk=>{raw+=chunk;});
    socket.once("end",()=>{try{resolve(JSON.parse(raw));}catch(error){reject(error);}});
    socket.once("connect",()=>socket.write(JSON.stringify(value)+"\n"));
  });
  try {
    const replies=await Promise.all(Array.from({length:80},()=>request({schema,operation:"reserve",weight:1,priority:"MARKET_DATA"})));
    assert.equal(reservations,80);
    assert.ok(replies.every(reply=>reply.ok===true&&reply.waitMs===0));
    assert.deepEqual(await request({schema,operation:"cancelOrder"}),{ok:false});
    assert.equal(reservations,80);
  } finally { await new Promise<void>(resolve=>server.close(()=>resolve())); }
});
