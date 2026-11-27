/** Source-native H1 PENGU real-market signal reconstruction, NO ORDERS.
 * Exactly pinned source function, two explicit mode arms, no execution fills.
 * Usage: tsx --tsconfig <repo/tsconfig.json> this.ts REPO_ROOT PENGU_H1 BTC_H1 FUNDING OUTPUT_JSON
 * Every input is read only. Writes one new JSON output; refuses overwrite.
 */
import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const H=3_600_000,START=Date.UTC(2025,9,1),END=Date.UTC(2026,9,1);
type Bar={openTime:number;closeTime:number;open:number;high:number;low:number;close:number;volume:number};
type Funding={fundingTime:number;fundingRate:number};
function fail(code:string):never{throw Error("PENGU_NATIVE_SOURCE_AUDIT:"+code);}
function checkBars(value:unknown,name:string):Bar[]{
 if(!Array.isArray(value)||value.length<181)fail(name+"_SHORT_WARMUP_MISSING");
 for(let i=0;i<value.length;i++){
  const b=value[i] as Bar;
  if(!b||!Number.isSafeInteger(b.openTime)||b.openTime<=0||b.openTime%H!==0
   ||b.closeTime!==b.openTime+H-1||
   ![b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)
   ||b.open<=0||b.low<=0||b.low>Math.min(b.open,b.close)
   ||b.high<Math.max(b.open,b.close)||b.volume<0||
   (i>0&&b.openTime!==(value[i-1] as Bar).openTime+H))fail(name+"_INVALID_H1_"+i);
 }
 return value as Bar[];
}
function checkFunding(value:unknown):Funding[]{
 if(!Array.isArray(value))fail("FUNDING_UNAVAILABLE");
 for(let i=0;i<value.length;i++){
  const r=value[i] as Funding;
  if(!r||!Number.isSafeInteger(r.fundingTime)||!Number.isFinite(r.fundingRate)
     ||(i>0&&r.fundingTime<=(value[i-1] as Funding).fundingTime))
    fail("FUNDING_CORRUPT_"+i);
 }
 return value as Funding[];
}
function parseFile(path:string){const raw=readFileSync(path);return {
 obj:JSON.parse(raw.toString("utf8")) as unknown,
 hash:createHash("sha256").update(raw).digest("hex")};}
(async()=>{
 const [root,penguPath,btcPath,fundingPath,output]=process.argv.slice(2);
 if(!root||!penguPath||!btcPath||!fundingPath||!output)fail("INPUTS_REQUIRED");
 const p=parseFile(penguPath),b=parseFile(btcPath),f=parseFile(fundingPath);
 const pengu=checkBars(p.obj,"PENGU"),btc=checkBars(b.obj,"BTC");
 const funding=checkFunding(f.obj);
 if(pengu.length!==btc.length||pengu.some((r,i)=>r.openTime!==btc[i].openTime))
  fail("H1_CROSS_ASSET_MISALIGNED");
 if(pengu[0].openTime>START-181*H||pengu.at(-1)!.openTime<END-H)
  fail("TARGET_WINDOW_OR_WARMUP_INCOMPLETE");
 if(funding.length===0||funding[0].fundingTime>START||funding.at(-1)!.fundingTime<END-8*H)
  fail("FUNDING_WINDOW_INCOMPLETE");

 const native=await import(pathToFileURL(resolve(root,"lib/pengu-dual-ls-v2.ts")).href);
 const history={pengu1h:pengu,btc1h:btc,penguFunding:funding};
 const rows=native.buildPenguDualLsV2EvaluationSeries(history,pengu.at(-1)!.closeTime+1);
 if(rows.length!==pengu.length)fail("SERIES_LENGTH_MISMATCH");
 const arms=[
  {name:"BASE",recoveryV8Enabled:false,v64DynamicLongEnabled:false},
  {name:"V8_V64",recoveryV8Enabled:true,v64DynamicLongEnabled:true},
 ];
 const events:Record<string,Array<{barTs:number;entryTs:number;symbol:string;side:"LONG"|"SHORT";route:string;gross:number;index:number}>>={BASE:[],V8_V64:[]};
 let featureMissing=0,ambiguous=0;
 for(let i=0;i<rows.length;i++){
  const r=rows[i],features=r.features;
  if(r.candle.openTime<START||r.candle.openTime>=END)continue;
  if(!features){featureMissing++;continue;}
  if(features.referenceTs!==r.candle.openTime||r.candle.openTime!==pengu[i].openTime)
   fail("SOURCE_REFERENCE_CLOCK_MISMATCH_"+i);
  const base=native.evaluatePenguDualLsV2Decision(features,r.shortSignal,r.longRaw&&!r.longSignal);
  const v64=native.isPenguV8V64DynamicLongSignal(rows,i);
  const recRow=r.recoveryV8?{...r.recoveryV8,ordinaryLongEligible:v64,baseLongSignal:v64}:undefined;
  const rec=native.selectPenguRecoveryV8Entry(recRow,true);
  const v8Side:-1|0|1= r.shortSignal?-1:v64?1:rec?.kind==="RECOVERY_V8"?1:0;
  const v8Route=r.shortSignal?"SHORT_V20":v64?"LONG_V2_FINAL":rec?.kind==="RECOVERY_V8"?"RECOVERY_V8":null;
  const selections=[
   {name:"BASE",side:base.side,route:base.side===-1?"SHORT_V20":base.side===1?"LONG_V2_FINAL":null},
   {name:"V8_V64",side:v8Side,route:v8Route},
  ];
  for(const z of selections){
   if(z.side===0)continue;
   if(!z.route||z.side!==1&&z.side!==-1)fail("NATIVE_ENTRY_SHAPE_INVALID_"+i);
   const entryTs=r.candle.openTime+H;
   if(entryTs>=END)continue;
   events[z.name].push({barTs:r.candle.openTime,entryTs,symbol:"PENGUUSDT",
    side:z.side===1?"LONG":"SHORT",route:z.route,gross:1,index:i});
  }
  if(base.side!==0&&v8Side!==0&&base.side!==v8Side)ambiguous++;
 }
 const parity:Record<string,{checked:number;mismatches:number;details:unknown[]}>={
  BASE:{checked:0,mismatches:0,details:[]},V8_V64:{checked:0,mismatches:0,details:[]}};
 for(const arm of arms){
  const found=events[arm.name];
  const indices=[...new Set([
    ...found.slice(0,12).map(e=>e.index),
    ...found.slice(-12).map(e=>e.index),
    ...found.filter((_,i)=>i%Math.max(1,Math.floor(found.length/16))===0).slice(0,16).map(e=>e.index),
  ])].sort((a,b)=>a-b);
  for(const i of indices){
   const event=found.find(e=>e.index===i)!;
   const now=pengu[i].openTime+H;
   const signal=native.buildPenguDualLsV2Signal({
    pengu1h:pengu.slice(0,i+1),btc1h:btc.slice(0,i+1),
    penguFunding:funding.filter(x=>x.fundingTime<now),
   },undefined,now,0,{recoveryV8Enabled:arm.recoveryV8Enabled,
     v64DynamicLongEnabled:arm.v64DynamicLongEnabled});
   parity[arm.name].checked++;
   if(signal.side!==(event.side==="LONG"?1:-1)||signal.entryTs!==now
      ||signal.entryVersion!==event.route||Math.abs(signal.targetGross-event.gross)>1e-9){
    parity[arm.name].mismatches++;
    parity[arm.name].details.push({i,expected:event,actual:{side:signal.side,entryTs:signal.entryTs,
      route:signal.entryVersion,gross:signal.targetGross,reason:signal.reason}});
   }
  }
 }
 const summary=Object.fromEntries(arms.map(a=>[a.name,{
  rawCandidates:events[a.name].length,
  longs:events[a.name].filter(e=>e.side==="LONG").length,
  shorts:events[a.name].filter(e=>e.side==="SHORT").length,
  byRoute:events[a.name].reduce((acc:Record<string,number>,e)=>{acc[e.route]=(acc[e.route]??0)+1;return acc;},{}),
  ...parity[a.name],
 }]));
 const report={
  schema:"stable4-pengu-real-h1-native-entry-ledger/v1",
  status:Object.values(parity).every(x=>x.mismatches===0)?"NATIVE_REAL_H1_RAW_SIGNAL_PARITY_PASS":"NATIVE_REAL_H1_RAW_SIGNAL_PARITY_MISMATCH",
  periodUtc:[new Date(START).toISOString(),new Date(END).toISOString()],
  source:"pinned PENGU dual LS V2 signal module and deterministic evaluation series",
  input:{pengu:{count:pengu.length,sha256:p.hash,startUtc:new Date(pengu[0].openTime).toISOString(),endUtc:new Date(pengu.at(-1)!.closeTime).toISOString()},
   btc:{count:btc.length,sha256:b.hash},funding:{count:funding.length,sha256:f.hash}},
  arms:summary, featureMissing,ambiguous,
  rawSignalEvents:{BASE:events.BASE.map(({index,...v})=>v),V8_V64:events.V8_V64.map(({index,...v})=>v)},
  limitations:[
   "Raw H1 source candidate signal only: no PENGU order, cooldown, funding PnL, M5 entry confirmation, Shared Risk, slot, gross or DD",
   "No source-native position lifecycle, resident STOP, partial fill, ASTER tick/quote, or signed account mark",
   "Source hash must be audited independently; source code is imported from a caller-provided checkout, no Root certificate",
   "V8/V64 runtime option arms are both shown; this does not establish which configuration was live",
  ],
  sourceRealMarketData:true,executionParityProven:false,annualProfitOrDdCertified:false,
  orderAuthority:false,productionEligible:false,rootCertificateIssued:false,
 };
 writeFileSync(output,JSON.stringify(report,null,2)+"\n",{flag:"wx"});
 console.log(JSON.stringify({status:report.status,summary,featuresMissing:featureMissing,
  totalBars:pengu.length,sourceOnly:true,output}));
 if(report.status!=="NATIVE_REAL_H1_RAW_SIGNAL_PARITY_PASS")process.exitCode=2;
})().catch(e=>{console.error(String(e));process.exitCode=1;});
