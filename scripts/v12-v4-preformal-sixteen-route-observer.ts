/* Outside formal 2025-08-10+ window: independent early-time route
 * opportunity coverage (Jan-Aug 2025), generated from closed Aster H1/H2.
 * Never confuses appearance of a route with out-of-period parity.
 */
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {join,dirname} from "node:path";
import {createHash} from "node:crypto";
import {V12_X1_ALL} from "../config/v12X1AllRuntime";
import {resampleV12H1ToH2,type V12Bar} from "../lib/v12-x1-all";
import {computeNativeV4Sources} from "../lib/v12-v4-native-source";
import {adaptProductionCandidates,computeProductionH1Features,type FeatureBar} from "../lib/v12-v4-production-features";
import {PRODUCTION_EXIT_CATALOG,productionExitSpec,evaluateProductionExit,type Leg} from "../lib/v12-v4-production-lifecycle";
const h=3600000;
const root=process.env.DISDEX_MARKET_KLINES||
 "C:/tmp/bt-v12-score100-volume080-normalonly-20260928/extracted/bt-v12-score100-volume080-normalonly-20260928/market-Aster-H1-funding-and-manifests/normalized/aster/klines";
const out="docs/ops/v12-v4-cert-20261009/preformal-2025-native-route-coverage.json";
const input=JSON.parse(readFileSync("docs/ops/v12-v4-cert-20261009/native-route-parity-after.json","utf8"));
const covered=new Set<string>(input.actual.map((x:{route:string})=>x.route));
const absent=PRODUCTION_EXIT_CATALOG.map(r=>r.route).filter(r=>!covered.has(r));
if(absent.length!==16)throw Error("16_TARGET_ROUTE_SET_UNKNOWN");
const h1:Record<string,FeatureBar[]>={};
const h2:Record<string,V12Bar[]>={};
const hashes:Record<string,string>={};
for(const s of V12_X1_ALL.universe){
 const sym=s+"USDT";const f=join(root,sym+".jsonl");
 const b=readFileSync(f,"utf8");
 hashes[sym]=createHash("sha256").update(b).digest("hex");
 const rows=b.trim().split(/\r?\n/).map(x=>JSON.parse(x));
 h1[s]=rows.map(x=>({openTs:Number(x.event_time_ms),open:Number(x.open),
   high:Number(x.high),low:Number(x.low),close:Number(x.close),
   quoteVolume:Number(x.quote_volume)}));
 h2[s]=resampleV12H1ToH2(rows.map(x=>({ts:Number(x.event_time_ms),
  open:Number(x.open),high:Number(x.high),low:Number(x.low),
  close:Number(x.close),volume:Number(x.base_volume),closed:true})));
}
let common=new Set(h2.BTC.map(b=>b.endTs));
for(const [symbol,v] of Object.entries(h2)){const valid=new Set(v.map(b=>b.endTs));common=new Set([...common].filter(x=>valid.has(x)));}
for(const k of Object.keys(h2))h2[k]=h2[k].filter(x=>common.has(x.endTs));
const h1ByTs=Object.fromEntries(Object.entries(h1).map(([s,rows])=>[
 s,new Map(rows.map(bar=>[bar.openTs,bar]))
])) as Record<string,Map<number,FeatureBar>>;
const candidateRecords:any[]=[];
const candidateKeys=new Set<string>();
const start=Date.parse("2025-01-13T00:00:00Z"),end=Date.parse("2025-08-10T00:00:00Z");
const stats=new Map(absent.map(route=>[route,{candidates:0,filtered:0,examples:[] as any[]}]));
const errors:{ts:number;symbol?:string;error:string}[]=[];let clocks=0,nativeCount=0;
for(let i=120;i<h2.BTC.length;i++){
 const ts=h2.BTC[i].endTs;if(ts<start||ts>=end)continue;
 clocks++;
 try{
  const signals=computeNativeV4Sources(h2,i,ts);nativeCount+=signals.length;
  for(const x of signals){
   const sym=x.source.symbol.slice(0,-4);const f=h1[sym];if(!f)continue;
   const r=adaptProductionCandidates({source:x.source,decisionTs:ts,
     symbolBars:f,btcBars:h1.BTC});
   for(const c of r.candidates)if(stats.has(c.route)&&c.eligibleEntryTs<end){
    const a=stats.get(c.route)!;
    const identity=[c.route,c.symbol,c.effectiveSide,c.eligibleEntryTs].join("|");
    if(candidateKeys.has(identity))continue;
    candidateKeys.add(identity);
    a.candidates++;
    const spec=productionExitSpec(c.route);
    const legEntry=h1ByTs[sym].get(c.eligibleEntryTs);
    if(!legEntry)throw Error("PRE_FORMAL_ENTRY_OPEN_MISSING:"+identity);
    const atr14=spec.kind==="ATR"?computeProductionH1Features(c.symbol,
      c.effectiveSide,c.eligibleEntryTs,ts,f,h1.BTC).atr14:undefined;
    const leg={qty:1,status:"OPEN",entryTs:c.eligibleEntryTs,entryNotional:legEntry.open,
       entryAtr:atr14,candidate:c} as Leg;
    let exit:ReturnType<typeof evaluateProductionExit>=null;
    for(let t=c.eligibleEntryTs;t<c.eligibleEntryTs+spec.hours*h;t+=h){
      const bar=h1ByTs[sym].get(t),next=h1ByTs[sym].get(t+h);
      if(!bar)throw Error("PRE_FORMAL_H1_EXIT_GAP:"+identity+":"+t);
      exit=evaluateProductionExit(leg,bar,t+h,next?{ts:t+h,price:next.open}:undefined);
      if(exit)break;
    }
    if(!exit)throw Error("PRE_FORMAL_EXIT_NOT_DECIDED:"+identity);
    candidateRecords.push({route:c.route,symbol:c.symbol,side:c.effectiveSide,
      rank:c.rank,requestedGross:c.requestedGross,entryTs:c.eligibleEntryTs,
      entryPrice:legEntry.open,entryAtr:atr14,exitTs:exit.exitTs,exitPrice:exit.price,
      exitReason:exit.reason});
    if(a.examples.length<15)a.examples.push({symbol:c.symbol,side:c.effectiveSide,
      rank:c.rank,eligibleEntryTs:c.eligibleEntryTs,gross:c.requestedGross});
   }
   for(const c of r.filtered)if(stats.has(c.route)){
    stats.get(c.route)!.filtered++;
   }
  }
 }catch(e){if(errors.length<100)errors.push({ts,error:String(e)});}
}
const results=absent.map(route=>({route,...stats.get(route)!}));
const report={status:errors.length?"BLOCKED":"READ_ONLY_PRE_FORMAL_ROUTE_OBSERVATION",
 historicalPreFormalPeriod:{start:"2025-01-13",endExclusive:"2025-08-10"},
 noFitPeriodOverlap:true,notPristineIndependentForward:true,
 clockCount:clocks,nativeCount,absentExternalRouteCount:16,
 observedRoutes:results.filter(x=>x.candidates>0).length,
 results,candidateRecords,errors,marketHashes:hashes,ordersSent:0,tradingMutation:0};
mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({status:report.status,clockCount:clocks,nativeCount,
 observedRoutes:report.observedRoutes,results:results.map(({route,candidates,filtered})=>({route,candidates,filtered})),
 errors:errors.slice(0,3)},null,2));
if(errors.length)process.exitCode=1;
