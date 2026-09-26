// Historical candidate evidence ONLY. Invokes verified CURRENT VPS native source exports.
// Deliberately contains NO strategy thresholds, custom ranking, exits, or portfolio BT.
import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { V12_X1_ALL } from "../../config/v12X1AllRuntime";
import { FET_BRK48_RESIDUAL } from "../../config/fetBrk48Runtime";
import { buildV12Signals, resampleV12H1ToH2, type V12Bar, type V12H1Candle } from "../../lib/v12-x1-all";
import { normalizeFetH1, buildFetBrk48Signal } from "../../lib/fet-brk48-signal";

const SOURCE_COMMIT="e1b58060d6263a3af7ced51bec854d3e211d2f35";
const TARGET_START=Date.parse("2025-08-10T00:00:00Z");
const TARGET_END=Date.parse("2026-08-10T00:00:00Z");
const FETCH_START=Date.parse("2025-07-01T00:00:00Z");
const FETCH_END=TARGET_END;
const HOUR=3_600_000;
const SYMBOLS=[...new Set([...V12_X1_ALL.universe.map(s=>s+"USDT"),FET_BRK48_RESIDUAL.symbol])];
const OUTPUT=path.resolve(".research-state/current-vps-native-v12-fet");
const VENUE="https://fapi.asterdex.com";
const sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));

async function get(url:string) {
  let last:Error|undefined;
  for(let attempt=1;attempt<=7;attempt++){
    try{
      const res=await fetch(url,{headers:{"User-Agent":"DisDex-OriginalVPS-NativeBT-SourceRecovery/20260926","Accept":"application/json"}});
      if(!res.ok)throw new Error("HTTP "+res.status+" "+(await res.text()).slice(0,160));
      const rows=await res.json();
      if(!Array.isArray(rows))throw new Error("Aster non-array response");
      return rows as unknown[][];
    }catch(e){last=e as Error;await sleep(Math.min(12_000,550*attempt*attempt));}
  }
  throw new Error("ASTER_HISTORY_FETCH_FAILED "+url+" "+last);
}
async function fetchH1(symbol:string):Promise<unknown[][]>{
  let start=FETCH_START,all:unknown[][]=[];
  for(let page=0;start<FETCH_END && page<30;page++){
    const url=VENUE+"/fapi/v3/klines?"+new URLSearchParams({
      symbol,interval:"1h",startTime:String(start),endTime:String(FETCH_END-1),limit:"1500"
    });
    const rows=await get(url);
    if(!rows.length)break;
    all.push(...rows);
    const end=Math.max(...rows.map(r=>Number(r[0])));
    const next=end+HOUR;
    if(!(next>start))throw new Error("ASTER_H1_CURSOR_STALLED "+symbol);
    start=next;
    if(rows.length<1500)break;
    await sleep(110);
  }
  const map=new Map<number,unknown[]>();
  for(const row of all){
    const t=Number(row[0]);
    if(t>=FETCH_START && t<FETCH_END && Number.isFinite(t))map.set(t,row);
  }
  const clean=[...map.entries()].sort(([a],[b])=>a-b).map(x=>x[1]);
  if(clean.length<200)throw new Error("ASTER_H1_INSUFFICIENT_HISTORY "+symbol+" "+clean.length);
  return clean;
}

async function main(){
  await fs.mkdir(OUTPUT,{recursive:true});
  // Freeze original native source by validating checkout commit, not by copying
  // its thresholds into this adapter. Static historical dates never become LIVE.
  const {execFileSync}=await import("node:child_process");
  const head=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
  if(head!==SOURCE_COMMIT)throw new Error("CURRENT_VPS_GIT_SOURCE_NOT_PINNED "+head);
  const market:Record<string,unknown[][]>={};
  // Explicit serial requests avoid triggering Aster's rate lock; no LIVE auth used.
  for(const s of SYMBOLS){
    market[s]=await fetchH1(s);
    await fs.writeFile(path.join(OUTPUT,s+".json"),JSON.stringify(market[s]));
    console.log("SOURCE_VENUE_H1_READY",s,market[s].length,
      market[s][0][0],market[s][market[s].length-1][0]);
    await sleep(250);
  }
  const btcRows=market.BTCUSDT.map(row=>({
    ts:Number(row[0]),open:Number(row[1]),high:Number(row[2]),low:Number(row[3]),
    close:Number(row[4]),volume:Number(row[5]),closed:true
  } satisfies V12H1Candle));
  const btcH2=resampleV12H1ToH2(btcRows);
  if(btcH2.length<365*12)throw new Error("BTC_HISTORY_INCOMPLETE "+btcH2.length);
  const h2BySymbol=new Map<string,Map<number,V12Bar>>();
  for(const symbol of V12_X1_ALL.universe){
    const raw=market[symbol+"USDT"];
    const h2=resampleV12H1ToH2(raw.map(row=>({
      ts:Number(row[0]),open:Number(row[1]),high:Number(row[2]),low:Number(row[3]),
      close:Number(row[4]),volume:Number(row[5]),closed:true
    } satisfies V12H1Candle)));
    h2BySymbol.set(symbol,new Map(h2.map(b=>[b.ts,b])));
  }
  const times=btcH2.map(x=>x.ts);
  const full:Record<string,V12Bar[]>={BTC:btcH2};
  const eligibleStreak:Record<string,number>={};
  const perSymbolAvailableFrom:Record<string,string>={};
  for(const sym of V12_X1_ALL.universe){
    const map=h2BySymbol.get(sym)!;
    if(sym==="BTC")continue;
    full[sym]=times.map(ts=>map.get(ts)) as V12Bar[];
    eligibleStreak[sym]=0;
  }
  const v12Signals:Array<Record<string,unknown>>=[];
  const rankCounts:Record<string,number>={};
  const gateCounts:Record<string,number>={};
  const indexStart=times.findIndex(t=>t>=TARGET_START);
  const indexEnd=times.findIndex(t=>t>=TARGET_END);
  const endIdx=indexEnd<0?times.length:indexEnd;
  for(let i=160;i<endIdx;i++){
    if(i===0||times[i]-times[i-1]!==2*HOUR)continue;
    // Only include a currency after 160 real, contiguous H2 bars; never
    // fabricate or forward-fill a missing historical candle.
    const subset:Record<string,V12Bar[]>={BTC:btcH2};
    for(const sym of V12_X1_ALL.universe){
      if(sym==="BTC")continue;
      const bars=full[sym];
      const b=bars[i];
      const prev=bars[i-1];
      eligibleStreak[sym]=(b && prev && b.ts-prev.ts===2*HOUR)
        ?eligibleStreak[sym]+1:(b?1:0);
      if(eligibleStreak[sym]>=160){
        subset[sym]=bars;
        if(!perSymbolAvailableFrom[sym])perSymbolAvailableFrom[sym]=new Date(times[i]).toISOString();
      }
    }
    if(times[i]<TARGET_START)continue; // Warm up every symbol before target; never discard Aug10-Aug16 signals.
    const signals=buildV12Signals(subset,i,3); // ACTUAL production function
    for(const s of signals){
      rankCounts[String(s.rank)]=(rankCounts[String(s.rank)]||0)+1;
      gateCounts[String(s.entryGateReason||"")]=(gateCounts[String(s.entryGateReason||"")]||0)+1;
      v12Signals.push({...s,barTs:times[i],nativeSource:"lib/v12-x1-all.ts::buildV12Signals"});
    }
  }
  // Native FET candidate generator, same original H1 history. Exit/profit
  // protection and portfolio admission intentionally NOT guessed here.
  const fetRows=normalizeFetH1(market.FETUSDT as any[],TARGET_END);
  const fetSignals:Array<Record<string,unknown>>=[];
  const first=Math.ceil(TARGET_START/HOUR)*HOUR;
  for(let ts=first;ts<TARGET_END;ts+=HOUR){
    if(new Date(ts).getUTCHours()%FET_BRK48_RESIDUAL.decisionEntryHourModulo!==FET_BRK48_RESIDUAL.decisionEntryHourRemainder)continue;
    const s=buildFetBrk48Signal(fetRows,ts);
    if(s)fetSignals.push({...s,nativeSource:"lib/fet-brk48-signal.ts::buildFetBrk48Signal"});
  }
  for(const [name,rows] of [["v12-candidates.json",v12Signals],["fet-candidates.json",fetSignals]] as const)
    await fs.writeFile(path.join(OUTPUT,name),JSON.stringify(rows,null,2));
  const fileSha:Record<string,string>={};
  for(const s of SYMBOLS)fileSha[s]=crypto.createHash("sha256").update(await fs.readFile(path.join(OUTPUT,s+".json"))).digest("hex");
  const summary={
    schema:"verified-current-vps-native-v12-fet-candidates/v1",
    status:"NATIVE_SIGNAL_SOURCES_ONLY_NO_PORTFOLIO_BT_YET",
    sourceCommit:SOURCE_COMMIT,
    signalProvenance:["lib/v12-x1-all.ts","config/v12X1AllRuntime.ts",
      "lib/fet-brk48-signal.ts","config/fetBrk48Runtime.ts"],
    venue:"ASTER_FUTURES_V3_PUBLIC_H1",downloadStart:new Date(FETCH_START).toISOString(),
    targetPeriod:[new Date(TARGET_START).toISOString(),new Date(TARGET_END).toISOString()],
    marketRows:Object.fromEntries(SYMBOLS.map(s=>[s,market[s].length])),
    marketSha256:fileSha,
    candidateCounts:{v12:v12Signals.length,fet:fetSignals.length,v12ByRank:rankCounts,v12ByGate:gateCounts},
    perSymbolAvailableFrom,fnSignatures:"production-export-calls-no-reimplementation",
    qualifications:[
      "Signals are not fills; no leverage, slippage, exit, governor or inter-sleeve competition is simulated.",
      "FET signal entryPrice is causal H1 reference close, not verified Aster executable order fill.",
      "Q102 and V52 native current replay not included in this signal-only artifact."
    ],
    safety:{researchOnly:true,ordersSent:false,tradingMutation:0}
  };
  await fs.writeFile(path.join(OUTPUT,"summary.json"),JSON.stringify(summary,null,2));
  console.log("VERIFIED_CURRENT_VPS_NATIVE_V12_FET_SIGNAL_SUMMARY="+JSON.stringify({
    sourceCommit:SOURCE_COMMIT,v12:v12Signals.length,fet:fetSignals.length,rankCounts,gateCounts,
    firstV12:v12Signals[0]?.entryTs,lastV12:v12Signals.at(-1)?.entryTs,
    firstFet:fetSignals[0]?.entryTs,lastFet:fetSignals.at(-1)?.entryTs
  }));
}
main().catch(e=>{console.error(e);process.exitCode=1});
