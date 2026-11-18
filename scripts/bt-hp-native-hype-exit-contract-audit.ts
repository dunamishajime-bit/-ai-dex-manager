/**
 * Research-only HYPE TREND immutable-source bracket and M5 exit check.
 * Source parity must be kept distinct from venue/portfolio parity.
 * Zero API calls, credentials, order sends or production updates.
 */
import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {resolve,join} from "node:path";
type H1={openTime:number;open:number;high:number;low:number;close:number;volume:number};
type Signal={
 accepted:boolean;signalTsMs:number|null;atr:number|null;
 stopDistance:number|null;trailingDistance:number|null;reason:string
};
type Prior={
 strategy_id:string;signal_ts_ms:number;entry_ts_ms:number;entry_price:number;
 exit_ts_ms:number;exit_price:number;exit_reason:string;
 pinned_exit_inputs:{signalAtr:number;stopDistance:number;takeProfitDistance:number;walletStopPrice:number;
 effectiveStopPrice:number;effectiveTakeProfitPrice:number;walletRiskPct:number;grossCappedAt:number}
};
type M5={time:number;open:number;high:number;low:number;close:number};
const HOUR=3_600_000,M5_MS=300_000;
const START=Date.parse("2025-10-01T00:00:00Z"),END=Date.parse("2026-10-01T00:00:00Z");
const sha=(data:Buffer)=>createHash("sha256").update(data).digest("hex");
const opt=(key:string)=>{
 const index=process.argv.indexOf("--"+key);
 if(index<0||!process.argv[index+1]||process.argv[index+1].startsWith("--"))throw Error("MISSING_"+key);
 return resolve(process.argv[index+1]);
};
const bytes=(path:string)=>readFileSync(path);
function near(a:number,b:number){
 return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.max(1e-8,Math.abs(b)*1e-8);
}
export function validateHistoricalM5(data:{symbol:string;timeframeMs:number;rows:unknown[]}):M5[]{
 if(data.symbol!=="HYPEUSDT"||data.timeframeMs!==M5_MS||!Array.isArray(data.rows))throw Error("M5_SOURCE_INVALID");
 const out:M5[]=[];
 for(const row of data.rows){
  if(!Array.isArray(row)||row.length<6)throw Error("M5_ROW_INVALID");
  const [time,open,high,low,close]=row.map(Number);
  if(![time,open,high,low,close].every(Number.isFinite)||time<=0||time%M5_MS!==0||
     low<=0||low>Math.min(open,close)||high<Math.max(open,close)||
     (out.length>0&&time-out[out.length-1].time!==M5_MS))throw Error("M5_GAP_OR_PRICE_INVALID:"+time);
  out.push({time,open,high,low,close});
 }
 if(out.length<100_000)throw Error("M5_SOURCE_INCOMPLETE");
 return out;
}
export function bracketExitOnBars(bars:readonly M5[],entryTs:number,stop:number,tp:number,holdHours:number){
 if(!bars.length||!(stop>0&&tp>stop&&holdHours>0))throw Error("INVALID_EXIT_INPUTS");
 const limit=entryTs+holdHours*HOUR;
 for(const bar of bars){
  if(bar.time<entryTs)continue;
  if(bar.time>=limit)return {time:bar.time,price:bar.open,reason:"MAX_HOLD_M5_OPEN_PROXY" as const,ambiguous:false};
  const sl=bar.low<=stop,win=bar.high>=tp;
  if(sl)return {time:bar.time,price:Math.min(bar.open,stop),reason:"HARD_STOP" as const,ambiguous:win};
  if(win)return {time:bar.time,price:Math.max(bar.open,tp),reason:"TAKE_PROFIT" as const,ambiguous:false};
 }
 return {time:null,price:null,reason:"INCOMPLETE_HISTORY" as const,ambiguous:false};
}
export function compareModeledExit(modeled:Prior,actual:{time:number|null;price:number|null;reason:string}){
 const expected=modelledReason(modeled.exit_reason);
 return {
  // Archived modeled exit timestamps are the END of a 5-minute bar, not the open.
  timeMatch:actual.time!==null&&actual.time+M5_MS===modeled.exit_ts_ms,
  priceMatch:actual.price!==null&&near(actual.price,modeled.exit_price),
  reasonMatch:actual.reason===expected
 };
}
function modelledReason(reason:string):string{
 if(reason==="PINNED_HYPE_HARD_STOP")return "HARD_STOP";
 if(reason==="PINNED_HYPE_TAKE_PROFIT")return "TAKE_PROFIT";
 return "UNKNOWN_PRIOR_EXIT";
}
async function main(){
 const src=opt("live-source-root");
 const btc=opt("btc-h1"),hype=opt("hype-h1"),m5path=opt("hype-m5");
 const priorPath=opt("prior-candidates"),out=opt("output");
 const metadata=JSON.parse(bytes(priorPath).toString("utf8")) as Prior[];
 const btcRaw=JSON.parse(bytes(btc).toString("utf8")) as {rows:unknown[][]};
 const hypeRaw=JSON.parse(bytes(hype).toString("utf8")) as {rows:unknown[][]};
 const toH1=(r:unknown[][]):H1[]=>
  r.map(x=>({openTime:Number(x[0]),open:Number(x[1]),high:Number(x[2]),low:Number(x[3]),
    close:Number(x[4]),volume:Number(x[5])}));
 const b=toH1(btcRaw.rows),h=toH1(hypeRaw.rows);
 if(b.length!==h.length||b.length<8_900||b.some((row,i)=>row.openTime!==h[i].openTime||
   (i>0&&row.openTime!==b[i-1].openTime+HOUR)))throw Error("H1_INPUT_ALIGNMENT_DRIFT");
 const m5=validateHistoricalM5(JSON.parse(bytes(m5path).toString("utf8")));
 const h1ByTime=new Map(h.map((row,i)=>[row.openTime,i]));
 const m5Index=new Map(m5.map((row,i)=>[row.time,i]));
 const live=await import(pathToFileURL(join(src,"lib/hype-trend-long-signal.ts")).href) as {
  buildHypeTrendSignal:(x:{btc:H1[];hype:H1[];now:number})=>Signal;
 };
 const overlay=await import(pathToFileURL(join(src,"lib/disdex-exit-overlay-contract.ts")).href) as {
  calculateWalletRiskStop:(x:{side:"LONG";entryPrice:number;equity:number;acceptedGross:number;
    walletRiskPct:number;roundTripCostBps:number})=>{stopPrice:number};
  moreProtectiveStop:(side:"LONG",stop:number,overlay:number)=>number;
 };
 const runner=readFileSync(join(src,"lib/hype-zec-long-runner.ts"),"utf8");
 const policy=readFileSync(join(src,"config/hypeTrendLongPolicy.ts"),"utf8");
 const wallet=readFileSync(join(src,"config/hypeZecLongPolicy.ts"),"utf8");
 const riskRuntime=readFileSync(join(src,"config/hypeZecLongRuntime.ts"),"utf8");
 const sizing=readFileSync(join(src,"lib/hype-zec-long-sleeves.ts"),"utf8");
 const costConfig=JSON.parse(bytes(opt("runtime-cost-evidence")).toString("utf8")) as {
  releaseSha:string;resolved:Record<string,number>};
 const runtime=costConfig.resolved;
 const cost=2*runtime.DISDEX_HYPE_ZEC_FEE_BPS_PER_SIDE+
    runtime.DISDEX_HYPE_ZEC_MAX_SLIPPAGE_BPS+runtime.DISDEX_HYPE_ZEC_FUNDING_BPS;
 if(costConfig.releaseSha!=="a7eee1f91d86d51f2333da117243d044ae1332dc"||
    !near(cost,30)||!wallet.includes("walletStopRiskPct: 2")||
    !riskRuntime.includes("Math.abs(runtime.hypeRiskPct - 5.0)")||
    !sizing.includes("riskBudgetUsd = equity * policy.riskPct / 100")||
    !sizing.includes("Math.min(riskQuantity, grossQuantity)")||
    !policy.includes("maximumHoldHours: 168")||
    !runner.includes("moreProtectiveStop(\"LONG\", trendStop, walletRiskStop)")||
    !runner.includes("await this.dependencies.adapter.placeTakeProfit({")||
    !runner.includes("await this.dependencies.adapter.placeStopMarket({")||
    !runner.includes("quote.bidPrice >= owned.takeProfitPrice")||
    /owned\.peakPrice\s*=/.test(runner))
   throw Error("UNRECOGNIZED_NATIVE_BRACKET_AND_NO_TRAIL_SOURCE_CONTRACT");
 const summary={bracketsMatched:0,bracketsDrift:0,modelExitMatch:0,modelExitTimeDrift:0,
    modelExitPriceDrift:0,modelExitReasonDrift:0,bothStopsTouched:0,missingHistory:0};
 const sampleDrift:unknown[]=[];
 const outRows:unknown[]=[];
 if(metadata.length!==78)throw Error("UNEXPECTED_HYPE_PINNED_MODEL_CANDIDATE_COUNT");
 for(const row of metadata){
  if(row.strategy_id!=="HYPE_LONG"||row.entry_ts_ms!==row.signal_ts_ms+HOUR||
     !row.pinned_exit_inputs||!m5Index.has(row.entry_ts_ms))throw Error("UNVERIFIABLE_MODEL_ENTRY");
  if(!(row.entry_ts_ms>=START&&row.entry_ts_ms<END))throw Error("ENTRY_OUTSIDE_MODEL_PERIOD");
  const index=h1ByTime.get(row.signal_ts_ms);
  if(index===undefined||index+1>=h.length)throw Error("H1_SIGNAL_ENTRY_MISSING");
  const native=live.buildHypeTrendSignal({btc:b.slice(0,index+1),hype:h.slice(0,index+1),now:row.entry_ts_ms});
  if(!native.accepted||native.signalTsMs!==row.signal_ts_ms||
    !(native.stopDistance&&native.trailingDistance&&native.atr))throw Error("NATIVE_SIGNAL_NOT_RECONSTRUCTED");
  const entry=h[index+1].open;
  const prior=row.pinned_exit_inputs;
  // The historical source used continuous risk sizing, not always cap=1.5x:
  // 5% wallet risk / (ATR stop distance + 30bps cost), capped at 1.5x.
  // Live round-lot quantity/venue fill are unavailable: model parity only.
  const modelRiskFraction=native.stopDistance/entry+cost/10_000;
  const acceptedGross=Math.min(prior.grossCappedAt,0.05/modelRiskFraction);
  const nativeWallet=overlay.calculateWalletRiskStop({
    side:"LONG",entryPrice:entry,equity:10_000,acceptedGross,
    walletRiskPct:prior.walletRiskPct,roundTripCostBps:cost}).stopPrice;
  const nativeStop=overlay.moreProtectiveStop("LONG",entry-native.stopDistance,nativeWallet);
  const nativeTp=entry+native.trailingDistance;
  const bracketMatches=[
   near(entry,row.entry_price),near(native.atr,prior.signalAtr),
   near(native.stopDistance,prior.stopDistance),
   near(native.trailingDistance,prior.takeProfitDistance),
   near(nativeWallet,prior.walletStopPrice),
   near(nativeStop,prior.effectiveStopPrice),
   near(nativeTp,prior.effectiveTakeProfitPrice),
   near(prior.walletRiskPct,2),near(prior.grossCappedAt,1.5)
  ].every(Boolean);
  summary.bracketsMatched+=Number(bracketMatches);
  summary.bracketsDrift+=Number(!bracketMatches);
  const pos=m5Index.get(row.entry_ts_ms)!;
  const m5exit=bracketExitOnBars(m5.slice(pos,pos+168*12+13),
     row.entry_ts_ms,nativeStop,nativeTp,168);
  if(m5exit.reason==="INCOMPLETE_HISTORY")summary.missingHistory++;
  if(m5exit.ambiguous)summary.bothStopsTouched++;
  const comparable=compareModeledExit(row,m5exit);
  if(comparable.timeMatch&&comparable.priceMatch&&comparable.reasonMatch)summary.modelExitMatch++;
  if(!comparable.timeMatch)summary.modelExitTimeDrift++;
  if(!comparable.priceMatch)summary.modelExitPriceDrift++;
  if(!comparable.reasonMatch)summary.modelExitReasonDrift++;
  if(!bracketMatches||!comparable.timeMatch||!comparable.priceMatch||!comparable.reasonMatch){
   if(sampleDrift.length<15)sampleDrift.push({
    signalTsMs:row.signal_ts_ms,bracketMatches,
    recorded:{time:row.exit_ts_ms,price:row.exit_price,reason:row.exit_reason},
    replay:m5exit,matched:comparable});
  }
  outRows.push({
   signalTime:new Date(row.signal_ts_ms).toISOString(),modelEntryTime:new Date(row.entry_ts_ms).toISOString(),
   entryPrice:entry,nativeStop,nativeTakeProfit:nativeTp,nativeStopWalletOverlay:nativeWallet,
   nativeAtr:native.atr,bracketMatches,modeledExitTimestampMatch:comparable.timeMatch,
   modeledExitPriceMatch:comparable.priceMatch,modeledExitReasonMatch:comparable.reasonMatch,
   ambiguousM5ExitBar:m5exit.ambiguous
  });
 }
 const result={
  schema:"disdex-bt-native-hype-exit-contract-reconciliation/v1",
  verdict:summary.bracketsDrift===0&&summary.modelExitTimeDrift===0&&
    summary.modelExitPriceDrift===0&&summary.modelExitReasonDrift===0&&
    summary.missingHistory===0?"ARCHIVED_HYPE_EXIT_MODEL_EXACT_M5_PROXY_MATCH":
    "ARCHIVED_HYPE_EXIT_MODEL_DRIFT_REQUIRES_RECONSTRUCTION",
  sourceScope:"HYPE_TREND_RESEARCH_SOURCE_EXIT_PROXY_NOT_SIGNED_VENUE",
  nativeSignalPin:costConfig.releaseSha,modeledHistoricalCandidates:metadata.length,
  firstTouchM5StopFirst:true,costInputsBps:{feePerSide:runtime.DISDEX_HYPE_ZEC_FEE_BPS_PER_SIDE,
    maximumSlippage:runtime.DISDEX_HYPE_ZEC_MAX_SLIPPAGE_BPS,
    fundingEstimate:runtime.DISDEX_HYPE_ZEC_FUNDING_BPS},
  sourceIncludesResidentStopAndTakeProfit:true,
  sourceHasDynamicTrailingStopRefresh:false,
  sourceIncludesWallet2PercentOverlay:true,
  sourceRiskSizingWalletBudgetPercent:5,
  modelEntryUsesNextH1BarOpen:true,
  modelUsesContinuousGrossWithoutVenueLotStep:true,
  actualVenueQuantityAndTickRoundingUnverified:true,
  actualTradeExecutionAndFundingCashflowsUnverified:true,
  nativeMaximumHoldHours:168,
  summary,sampleDrift,observations:outRows,
  sourceHashes:{
   liveRunner:sha(bytes(join(src,"lib/hype-zec-long-runner.ts"))),
   liveSignal:sha(bytes(join(src,"lib/hype-trend-long-signal.ts"))),
   walletOverlay:sha(bytes(join(src,"lib/disdex-exit-overlay-contract.ts"))),
   priorCandidates:sha(bytes(priorPath)),h1btc:sha(bytes(btc)),h1hype:sha(bytes(hype)),
   m5hype:sha(bytes(m5path)),sanitizedCostEvidence:sha(bytes(opt("runtime-cost-evidence")))
  },
  economicParityCertified:false,
  realVenueStopReadbackVerified:false,portfolioRiskGatesSimulated:false,
  executedOrders:0
 };
 writeFileSync(out,JSON.stringify(result,null,2)+"\n","utf8");
 console.log(JSON.stringify({verdict:result.verdict,summary,hash:sha(bytes(out))}));
 if(result.verdict!=="ARCHIVED_HYPE_EXIT_MODEL_EXACT_M5_PROXY_MATCH")process.exitCode=2;
}
if(process.argv[1]?.endsWith("bt-hp-native-hype-exit-contract-audit.ts"))
 main().catch(e=>{console.error("OFFLINE_HYPE_EXIT_AUDIT_FAILED:"+(e instanceof Error?e.message:String(e)));process.exitCode=1;});
