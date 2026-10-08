import { readFile, realpath, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { configurationPlan, hasUnresolvedIntent } from "./disdex-account-config-policy.mjs";
async function main() {
 const root=await realpath("/home/deploy/disdex-trading/current");
 const sha=(await readFile(join(root,".disdex-release-sha"),"utf8")).trim();
 if (!/^[a-f0-9]{40}$/.test(sha) || !root.endsWith("/"+sha) || process.env.DISDEX_CONFIG_RUNTIME_SHA!==sha) throw new Error("CONFIG_RELEASE_MISMATCH");
 const symbols=JSON.parse(await readFile("/etc/disdex/account-config-symbols.json","utf8"));
 if (!Array.isArray(symbols)||!symbols.length||symbols.some(x=>typeof x!=="string"||! /^[A-Z0-9]+USDT$/.test(x))) throw new Error("CONFIG_SYMBOL_POLICY_INVALID");
 const apply=process.argv.includes("--apply");
 if (apply && !process.argv.includes("--ack-flat-config-5x-cross")) throw new Error("CONFIG_ACK_REQUIRED");
 const api:any=await import(pathToFileURL(join(root,"lib/aster-v3-client.ts")).href);
 const locks:any=await import(pathToFileURL(join(root,"lib/disdex-account-order-lock.ts")).href);
 const Aster=api.AsterV3Client||api.default?.AsterV3Client;
 const Lock=locks.FileAccountOrderLock||locks.default?.FileAccountOrderLock;
 const client=new Aster({baseUrl:process.env.ASTER_FUTURES_BASE_URL,userAddress:process.env.ASTER_USER_ADDRESS,privateKey:process.env.ASTER_API_PRIVATE_KEY,readOnlyRateLimitMaxRetries:0,userAgent:"DisDex-Account-Config-Readiness"});
 if (!client.hasTradingCredentials()) throw new Error("CONFIG_CREDENTIALS_MISSING");
 const lock=new Lock(process.env.DISDEX_ACCOUNT_LOCK_PATH||"/var/lib/disdex/shared/account-order.lock",120000);
 const handle=await lock.acquire("ACCOUNT_CONFIG_READINESS:"+process.pid);
 if (!handle) { console.log(JSON.stringify({status:"CONFIG_DEFER_ACCOUNT_BUSY",ordersSent:0}));return; }
 try {
  const registryApi:any=await import(pathToFileURL(join(root,"lib/disdex-pending-exposure-registry.ts")).href);
  const normalize=(registryApi.normalizePendingExposureRegistry||registryApi.default?.normalizePendingExposureRegistry);
  const registry=normalize(JSON.parse(await readFile(process.env.DISDEX_PENDING_EXPOSURE_REGISTRY_PATH||"/var/lib/disdex/shared/pending-exposure.json","utf8")));
  const states=[];
  for (const p of ["/var/lib/disdex/quality102-causal-v1/state.json","/var/lib/disdex/v12-x1-all/runner.json","/var/lib/disdex/fet-brk48-residual/state.json","/var/lib/disdex/pengu-dual-ls-v2/runner-live.json","/var/lib/disdex/v52-aster-only/runner-live.json","/var/lib/disdex/hype-zec-long/runner.json","/var/lib/disdex/idle-priority/state.json","/var/lib/disdex/idle-priority/residual-long-state.json"]) states.push(JSON.parse(await readFile(p,"utf8")));
  if(hasUnresolvedIntent(registry,states)) { console.log(JSON.stringify({status:"CONFIG_DEFER_PENDING",ordersSent:0}));return; }
  const positions=await client.getPositions();const orders=await client.getOpenOrders();
  const plan=configurationPlan(symbols,positions,orders);const changed=[];
  if (apply) for (const c of plan) {
   // Re-read target under the shared lock immediately before every mutation.
   configurationPlan([c.symbol],await client.getPositions(c.symbol),await client.getOpenOrders(c.symbol));
   if(c.marginChange) await client.setMarginType(c.symbol,"CROSSED");
   if(c.leverageChange) await client.setLeverage(c.symbol,5);
   const remaining=configurationPlan([c.symbol],await client.getPositions(c.symbol),await client.getOpenOrders(c.symbol));
   if(remaining.length) throw new Error("CONFIG_POST_CHANGE_NOT_READY:"+c.symbol);
   changed.push(c);
  }
  const result={status:apply?"CONFIG_READY":"CONFIG_AUDIT",checkedAt:Date.now(),runtimeSha:sha,symbols,plan,changed,ordersSent:0,cancelsSent:0,positionChangesSent:0};
  const output="/var/lib/disdex/shared/account-config-readiness.json";const tmp=output+"."+process.pid+".tmp";
  await writeFile(tmp,JSON.stringify(result,null,2)+"\n",{mode:0o600});await rename(tmp,output);console.log(JSON.stringify(result));
 } finally { await handle.release(); }
}
main().catch(e=>{console.error(JSON.stringify({status:"CONFIG_FAIL_CLOSED",reason:e.message,ordersSent:0}));process.exitCode=1;});
