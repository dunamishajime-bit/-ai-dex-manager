/** Historical source-to-route independent replay of the 16 routes absent in the
 * Aug-Oct external sample. Real closed Aster H1/H2 plus unmodified native
 * generator and Production candidate adapter. NO order privileges.
 *
 * Results are in-sample 2025-2026 coverage, NOT an unseen forward certificate.
 */
import {readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {V12_X1_ALL} from "../config/v12X1AllRuntime";
import {resampleV12H1ToH2,type V12Bar} from "../lib/v12-x1-all";
import {computeNativeV4Sources} from "../lib/v12-v4-native-source";
import {adaptProductionCandidates,type FeatureBar} from "../lib/v12-v4-production-features";
import {PRODUCTION_EXIT_CATALOG} from "../lib/v12-v4-production-lifecycle";
const ROOT=process.cwd();
const MARKET=process.env.DISDEX_MARKET_KLINES||
 "C:/tmp/bt-v12-score100-volume080-normalonly-20260928/extracted/bt-v12-score100-volume080-normalonly-20260928/market-Aster-H1-funding-and-manifests/normalized/aster/klines";
const CANDIDATES=join(ROOT,"docs/research/results/v4-production-cert-20261009/bt-baseline/cases/V2_M150_D05_CORE_NATIVE/candidates/crypto-price-model-candidates.jsonl");
const LEDGER=join(ROOT,"docs/research/results/v4-production-cert-20261009/bt-baseline/cases/V2_M150_D05_CORE_NATIVE/runs/PRICE_MODEL_10BPS/portfolio-trades.jsonl");
const EXTERNAL=join(ROOT,"docs/ops/v12-v4-cert-20261009/native-route-parity-after.json");
const OUTPUT=join(ROOT,"docs/ops/v12-v4-cert-20261009/historical-sixteen-independent-replay.json");
const lines=(p:string)=>readFileSync(p,"utf8").split(/\r?\n/).filter(Boolean).map((s:string)=>JSON.parse(s));
const sha=(p:string)=>createHash("sha256").update(readFileSync(p)).digest("hex");
const ext=JSON.parse(readFileSync(EXTERNAL,"utf8"));
if(ext.status!=="PASS_NATIVE_ROUTE_ENTRY_REPLAY")throw Error("ORIGINAL_EXTERNAL_SOURCE_NOT_PASS");
const extRoutes=new Set<string>(ext.actual.map((x:any)=>x.route));
const missing=PRODUCTION_EXIT_CATALOG.map(x=>x.route).filter(r=>!extRoutes.has(r));
if(missing.length!==16)throw Error("MISSING_ROUTE_SET_CHANGED:"+missing.length);
const candidateAll=lines(CANDIDATES).filter((c:any)=>c.strategy_id==="V12");
const accepted=lines(LEDGER).filter((c:any)=>c.strategy_id==="V12"&&missing.includes(c.route));
const candidateByKey=new Map(candidateAll.map((c:any)=>[[c.route,c.symbol,c.side,c.entry_ts_ms].join("|"),c]));
const expected=accepted.map((a:any)=>{
 const c=candidateByKey.get([a.route,a.symbol,a.side,a.entry_ts_ms].join("|"));
 if(!c)throw Error("ACCEPTED_CANDIDATE_MISSING:"+a.route+":"+a.entry_ts_ms);
 // Non-reversal G/X candidate records omit redundant source metadata.
 // Their original generator signalTs and unchanged side carry the source key.
 const inferred=c.source_v12_entry_ts_ms===undefined;
 if(inferred&&(!/^REC_[GX]/.test(c.route)||c.signal_ts_ms!==c.entry_ts_ms))
  throw Error("ACCEPTED_SOURCE_KEY_NOT_VERIFIED:"+a.route+":"+a.entry_ts_ms);
 return {accepted:a,source:{...c,source_v12_entry_ts_ms:
  c.source_v12_entry_ts_ms??c.signal_ts_ms,source_v12_side:c.source_v12_side??c.side,
  sourceKeyInferredFromUnflippedSignal:inferred}};
});
const rawH1:Record<string,FeatureBar[]>={};
const universe:Record<string,V12Bar[]>={};
const hashes:Record<string,string>={};
for(const sym of V12_X1_ALL.universe){
 const symbol=sym+"USDT",path=join(MARKET,symbol+".jsonl");
 hashes[symbol]=sha(path);
 const b=lines(path);
 rawH1[symbol]=b.map((x:any)=>({
  openTs:Number(x.event_time_ms),open:Number(x.open),high:Number(x.high),
  low:Number(x.low),close:Number(x.close),quoteVolume:Number(x.quote_volume),
 }));
 universe[sym]=resampleV12H1ToH2(b.map((x:any)=>({
  ts:Number(x.event_time_ms),open:Number(x.open),high:Number(x.high),
  low:Number(x.low),close:Number(x.close),volume:Number(x.base_volume),closed:true,
 })));
}
let common=new Set(universe.BTC.map(b=>b.endTs));
for(const bars of Object.values(universe)){
 const times=new Set(bars.map(b=>b.endTs));
 common=new Set([...common].filter(t=>times.has(t)));
}
for(const sym of Object.keys(universe))universe[sym]=universe[sym].filter(x=>common.has(x.endTs));
const indexed=new Map(universe.BTC.map((b,i)=>[b.endTs,i]));
const sourceTs=[...new Set(expected.map(x=>x.source.source_v12_entry_ts_ms))].sort((a,b)=>a-b);
const sourcesByKey=new Map<string,ReturnType<typeof computeNativeV4Sources>[number]>();
const sourceGaps:any[]=[];
for(const ts of sourceTs){
 const ix=indexed.get(ts);
 if(ix===undefined||ix<120){sourceGaps.push({sourceTs:ts,reason:"H2_CLOCK_NOT_AVAILABLE_OR_WARM"});continue;}
 try{
  for(const s of computeNativeV4Sources(universe,ix,ts)){
   const key=[s.source.symbol,s.source.side,s.source.eligibleSourceEntryTs].join("|");
   if(sourcesByKey.has(key))throw Error("DUPLICATE_SOURCE:"+key);
   sourcesByKey.set(key,s);
  }
 }catch(e){sourceGaps.push({sourceTs:ts,reason:String(e)});}
}
const records:any[]=[],reasonCount:Record<string,number>={};
const mismatches:any[]=[];
for(const row of expected){
 const {accepted:a,source:c}=row;
 const key=[c.symbol,c.source_v12_side,c.source_v12_entry_ts_ms].join("|");
 const native=sourcesByKey.get(key);
 const record:any={route:a.route,symbol:a.symbol,side:a.side,
  entryTs:a.entry_ts_ms,sourceTs:c.source_v12_entry_ts_ms,
  nativeSourcePresent:!!native,pass:false};
 if(!native){record.reason="NATIVE_SOURCE_ABSENT";records.push(record);continue;}
 try{
  // Decision boundary is the actual eligible entry boundary, not after
  // the full trade, and feature computation sees only completed H1 bars.
  const adapted=adaptProductionCandidates({
   source:native.source,decisionTs:a.entry_ts_ms,
   symbolBars:rawH1[a.symbol],btcBars:rawH1.BTCUSDT,
  });
  const matches=adapted.candidates.filter((r:any)=>r.route===a.route&&
    r.symbol===a.symbol&&r.effectiveSide===a.side&&r.eligibleEntryTs===a.entry_ts_ms);
  record.adapterCount=adapted.candidates.length;
  record.adapterRoutes=adapted.candidates.map((r:any)=>r.route);
  record.filtered=adapted.filtered.map((r:any)=>r.route);
  record.deferred=adapted.deferred;
  record.pass=matches.length===1;
  if(matches.length===1){
   const got=matches[0];
   record.rankMatch=got.rank===c.rank;
   record.grossMatch=Math.abs(got.requestedGross-c.requested_gross)<1e-10;
   record.rank=got.rank;record.gross=got.requestedGross;
   record.pass=record.pass&&record.rankMatch&&record.grossMatch;
   if(!record.pass)record.reason="RANK_OR_GROSS_MISMATCH";
  }else record.reason="ADAPTER_CANDIDATE_IDENTITY_MISMATCH";
 }catch(e){record.reason=String(e);}
 records.push(record);
 if(!record.pass){
  reasonCount[record.reason]=(reasonCount[record.reason]??0)+1;
  if(mismatches.length<100)mismatches.push(record);
 }
}
const byRoute=missing.map(route=>({
 route,expected:records.filter(r=>r.route===route).length,
 nativeSources:records.filter(r=>r.route===route&&r.nativeSourcePresent).length,
 exact:records.filter(r=>r.route===route&&r.pass).length,
}));
const total=records.filter(r=>r.pass).length;
const report={status:total===expected.length&&sourceGaps.length===0?
 "PASS_HISTORICAL_SIXTEEN_IN_SAMPLE_SOURCE_AND_ENTRY":
 "BLOCKED_HISTORICAL_SIXTEEN_IN_SAMPLE_SOURCE_AND_ENTRY",
 evidenceScope:"Retrospective 2025-2026 accepted 16-route source identity, rank and sizing only. NOT independent forward unseen period. Does not imply broker/live authority.",
 missingRoutes:missing,expectedTrades:expected.length,matchedTrades:total,
 sourceClockCount:sourceTs.length,sourceResolvedCount:sourcesByKey.size,sourceGaps:sourceGaps.slice(0,100),
 byRoute,reasonCount,mismatches,marketHashes:hashes,
 inputHash:{candidates:sha(CANDIDATES),portfolio:sha(LEDGER),external:sha(EXTERNAL)},
 orderEnabled:false,realOrderEnabledV4:0,tradingMutation:0};
writeFileSync(OUTPUT,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({status:report.status,expected:report.expectedTrades,matched:report.matchedTrades,
 sourceClockCount:report.sourceClockCount,sourceGaps:report.sourceGaps.slice(0,4),
 reasonCount,byRoute},null,2));
if(total!==expected.length||sourceGaps.length)process.exitCode=1;
