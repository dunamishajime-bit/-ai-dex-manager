/** Read-only native exit audit. Usage: tsx SCRIPT FROZEN_BASELINE.jsonl.gz H1_KLINES_DIR */
import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {gunzipSync} from "node:zlib";
import {join} from "node:path";
import {evaluateNativeProductionExit,HOUR,type Leg,type H1Bar} from "../lib/v12-v4-production-lifecycle";
const [baselinePath,marketPath,evidenceOutput]=process.argv.slice(2);
const hash=(x:Buffer|string)=>createHash("sha256").update(x).digest("hex");
const marketHashes:Record<string,string>={};
if(!baselinePath||!marketPath)throw Error("NATIVE_PARITY_INPUT_PATHS_REQUIRED");
const raw=readFileSync(baselinePath);
const rows=(baselinePath.endsWith(".gz")?gunzipSync(raw):raw).toString("utf8").trim().split("\n").map(s=>JSON.parse(s));
const markets=new Map<string,Map<number,H1Bar>>();
const mismatches:any[]=[];
for(const c of rows) {
 if(!markets.has(c.symbol)) {
  const marketRaw=readFileSync(join(marketPath,c.symbol+".jsonl"),"utf8");marketHashes[c.symbol]=hash(marketRaw);
  const rows=marketRaw.trim().split("\n").map(s=>JSON.parse(s));
  markets.set(c.symbol,new Map(rows.map(b=>[Number(b.event_time_ms),{openTs:Number(b.event_time_ms),
    open:Number(b.open),high:Number(b.high),low:Number(b.low),close:Number(b.close)}])));
 }
 const market=markets.get(c.symbol)!;
 const l:Leg={id:"audit",candidate:{route:"REC_G3_LATE_BTC_REL",effectiveSide:c.side} as any,
  qty:1,entryNotional:Number(c.entry_price),requestedQty:1,reservationUsd:0,entryTs:Number(c.entry_ts_ms),
  entryAtr:Number(c.atr),nativeExitEvidence:"WR60_BASELINE_1978_PARITY",status:"OPEN",
  exitRemainingQty:0,realizedUsd:0,feesUsd:0,fundingUsd:0};
 let result:any=null;
 for(let ts=l.entryTs;ts<l.entryTs+46*HOUR;ts+=HOUR) {
  const bar=market.get(ts),next=market.get(ts+HOUR);
  if(!bar||!next)throw Error("NATIVE_PARITY_H1_DATA_GAP:"+c.symbol+":"+ts);
  const n=evaluateNativeProductionExit(l,bar,ts+HOUR,{ts:ts+HOUR,price:next.open});
  l.nativeStop=n.stop;l.nativePeak=n.peak;l.previousExitBar=bar;
  if(n.decision){result=n.decision;break;}
 }
 if(!result||result.exitTs!==Number(c.exit_ts_ms)||Math.abs(result.price-Number(c.exit_price))>1e-10||
   result.reason!==c.reason) {
  mismatches.push({symbol:c.symbol,entryTs:c.entry_ts_ms,actual:result,
    expected:{ts:c.exit_ts_ms,price:c.exit_price,reason:c.reason},maxHoldHours:c.maxHoldHours});
 }
}
const evidence={status:mismatches.length?"FAIL":"PASS",source:"WR60_FROZEN_BASELINE_NATIVE",capturedAt:new Date().toISOString(),
 sourceRows:rows.length,matching:rows.length-mismatches.length,mismatches:mismatches.slice(0,10),
 orderEnabled:false,realOrderEnabledV4:0,tradingMutation:0,priceModelOnly:true,
 sourceHashes:{frozenBaselineArchiveSha256:hash(raw),frozenBaselineContentSha256:hash(baselinePath.endsWith(".gz")?gunzipSync(raw):raw),
  h1KlinesSha256:marketHashes,lifecycleSha256:hash(readFileSync("lib/v12-v4-production-lifecycle.ts")),
  pureHelpersSha256:hash(readFileSync("lib/v12-x1-all.ts")),runtimeConfigSha256:hash(readFileSync("config/v12X1AllRuntime.ts"))},
 scope:"Native exit timestamp, price and reason only. H1 price model; not order/venue/native signal generation certification."};
if(evidenceOutput)writeFileSync(evidenceOutput,JSON.stringify(evidence,null,2)+"\n",{flag:"wx"});
process.stdout.write(JSON.stringify(evidence)+"\n");
if(mismatches.length)process.exitCode=1;
