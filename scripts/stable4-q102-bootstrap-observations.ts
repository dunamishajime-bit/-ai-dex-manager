/** Public historical observation bootstrap only. It cannot send venue mutations. */
import {existsSync,readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {dirname,isAbsolute,join} from "node:path";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {Stable4Q102OnlineEngine} from "../lib/disdex-quality102-stable4-online";
import {historicalQ102History} from "../lib/stable4-q102-bootstrap-history";
import type {Quality102Candle} from "../lib/disdex-quality102-causal-pipeline";
const H=3600000;
const arg=(key:string)=>{const i=process.argv.indexOf(key),v=i>=0?process.argv[i+1]:undefined;if(!v||v.startsWith("--"))throw Error("BOOTSTRAP_ARGUMENT_REQUIRED:"+key);return v;};
const rollingPath=arg("--rolling-h1"),statePath=arg("--state-path"),summaryPath=arg("--summary-path");
if(![rollingPath,statePath,summaryPath].every(isAbsolute)||statePath===rollingPath||summaryPath===statePath)throw Error("BOOTSTRAP_ABSOLUTE_DISTINCT_PATHS_REQUIRED");
const highVolSymbols=arg("--high-vol-symbols").split(",").map(x=>x.trim().toUpperCase()).filter(Boolean);
const root=process.env.DISDEX_STABLE4_RESEARCH_DATA_ROOT||"C:/tmp/disdex-bt-20251001-20261001";
const raw=readFileSync(rollingPath),rolling=JSON.parse(raw.toString("utf8"));
if(rolling.version!==1||!Array.isArray(rolling.symbols)||!rolling.candlesBySymbol||highVolSymbols.some(s=>!rolling.candlesBySymbol[s]))throw Error("BOOTSTRAP_ROLLING_CACHE_INVALID");
const seedMetadata=JSON.parse(readFileSync("config/stable4/q102-online-recovery-seed-20261114.json","utf8"));
const beforeStart=new Date(seedMetadata.candidateCoverageThrough-H);
const requiredPrefix=Date.UTC(beforeStart.getUTCFullYear(),beforeStart.getUTCMonth(),1)-(180*24+336)*H;
const source:Record<string,Quality102Candle[]>={};
for(const symbol of rolling.symbols){
 const current=rolling.candlesBySymbol[symbol] as Quality102Candle[],map=new Map<number,Quality102Candle>();
 const archive=join(root,`aster-public-v3-h1-q102-warmup/${symbol}-1h-20250301-20261001.jsonl.gz`);
 if(existsSync(archive))for(const line of gunzipSync(readFileSync(archive)).toString("utf8").trim().split(/\r?\n/)){
  const z=JSON.parse(line);if(+z[0]<current[0].timestampMs)map.set(+z[0],{timestampMs:+z[0],open:+z[1],high:+z[2],low:+z[3],close:+z[4],baseVolume:+z[5],quoteVolume:+z[7]});
 }
 for(const row of current)map.set(row.timestampMs,row);
 const rows=[...map.values()].filter(b=>b.timestampMs>=requiredPrefix).sort((a,b)=>a.timestampMs-b.timestampMs);
 if(rows.some((b,i)=>i>0&&b.timestampMs-rows[i-1].timestampMs!==H))throw Error("BOOTSTRAP_H1_ARCHIVE_GAP:"+symbol);
 source[symbol]=rows;
}
const last=Math.min(...Object.values(source).map(rows=>rows.at(-1)!.timestampMs));
if(last+H>Date.now()||last<=Date.UTC(2026,9,1))throw Error("BOOTSTRAP_SNAPSHOT_FRONTIER_INVALID");
mkdirSync(dirname(statePath),{recursive:true});mkdirSync(dirname(summaryPath),{recursive:true});
const engine=new Stable4Q102OnlineEngine({mode:"LIVE",recoverySeedPath:"config/stable4/q102-online-recovery-seed-20261114.json",avaxSeedPath:"config/stable4/q102-avax-knn-seed-20261114.json",statePath,highVolSymbols,requireHourlyCoverage:true});
const start=engine.learningStatus().observedThrough!+H;
let observations=0;
for(let t=start;t<=last;t+=H){engine.observe(historicalQ102History(source,t),t);observations++;if(observations%168===0)console.log(JSON.stringify({status:"OBSERVATION_BOOTSTRAP_PROGRESS",through:t,observations}));}
const result={schema:"disdex-stable4-observation-bootstrap/v1",status:"OBSERVATIONS_CAUGHT_UP_OUTCOME_EVIDENCE_PENDING",ordersEnabled:false,ordersSent:0,sourceCacheSha256:createHash("sha256").update(raw).digest("hex"),sourceSavedAt:rolling.savedAt,highVolSymbols,observationsThisRun:observations,firstObservedThisRun:start,lastObserved:last,model:engine.learningStatus(),pendingEvidenceRequests:engine.pendingEvidenceRequests(last+H)};
writeFileSync(summaryPath,JSON.stringify(result,null,2)+"\n",{mode:0o600});console.log(JSON.stringify(result,null,2));
