import * as fs from "node:fs";
import {evaluateStable4HypeSignal} from "./source/lib/hype-stable4-opportunity-signal";
import {createHypeH48TimeOnlyContract,evaluateHypeH48TimeOnlyExit} from "./source/lib/hype-stable4-time-only-contract";
const HOUR=3600000,SIX=6*HOUR;
const START=Date.parse("2025-10-01T00:00:00Z"),END=Date.parse("2026-10-01T00:00:00Z");
const [hypePath,btcPath,outPath]=process.argv.slice(2);
if(!hypePath||!btcPath||!outPath)throw Error("MISSING_ARGUMENT");
const load=(p:string)=>JSON.parse(fs.readFileSync(p,"utf8")).rows.map((r:any[])=>({ts:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4])}));
const hp=load(hypePath),bp=load(btcPath);
if(!hp.length||hp.length!==bp.length)throw Error("MISSING_MARKET_INPUT");
for(let i=0;i<hp.length;i++){
  if(hp[i].ts!==bp[i].ts)throw Error("NON_MATCHING_H1_TS");
  if(i&&hp[i].ts-hp[i-1].ts!==HOUR)throw Error("H1_MISSING_CANDLE");
}
const accepted:any[]=[],rejected:Record<string,number>={},risk:any[]=[];
let grids=0;
for(let i=24;i<hp.length;i++){
 const last=hp[i],now=last.ts+HOUR;
 if(now<START||now>=END||now%SIX)continue;
 grids++;
 const sig=evaluateStable4HypeSignal({now,btc1h:bp.slice(i-24,i+1),hype1h:hp.slice(i-24,i+1)});
 if(!sig.accepted){rejected[sig.reason]=(rejected[sig.reason]||0)+1;continue;}
 if(sig.signalTs!==now)throw Error("PIN_SIGNAL_TS_UNEXPECTED");
 const exitTs=now+48*HOUR,entryBar=hp[i+1],exitBar=hp[i+49];
 if(!entryBar||entryBar.ts!==now||!exitBar||exitBar.ts!==exitTs){
  risk.push({entryTs:now,reason:"H48_HISTORICAL_BOUNDARY_UNAVAILABLE"});continue;
 }
 const contract=createHypeH48TimeOnlyContract({positionId:"RESEARCH_ONLY_"+String(accepted.length).padStart(6,"0"),sourceSha:"e0e4f1d8f22b62e9410188ef6e590a20e31f760f",logicalEntryTs:now});
 if(evaluateHypeH48TimeOnlyExit(contract,exitTs-1).due!==false)throw Error("EARLY_EXIT_INCONSISTENT");
 const exit=evaluateHypeH48TimeOnlyExit(contract,exitTs,{openTs:exitTs,open:exitBar.open,observedAt:exitTs});
 if(!exit.due||exit.reason!=="HYPE_REDESIGN_TIME48_NEXTOPEN"||exit.referenceOpen!==exitBar.open)throw Error("H48_EXIT_PARITY_FAILED");
 let staleRejected=false,wrongBoundaryRejected=false;
 try{evaluateHypeH48TimeOnlyExit(contract,exitTs+120001,{openTs:exitTs,open:exitBar.open,observedAt:exitTs});}catch{staleRejected=true;}
 try{evaluateHypeH48TimeOnlyExit(contract,exitTs,{openTs:exitTs+HOUR,open:exitBar.open,observedAt:exitTs});}catch{wrongBoundaryRejected=true;}
 if(!staleRejected||!wrongBoundaryRejected)throw Error("H48_FAIL_CLOSED_MISSING");
 const entryOpen=entryBar.open,exitOpen=exitBar.open;
 accepted.push({
  entryTs:now,exitTs,route:"HYPE_REDESIGN_CAUSAL_H48R4_WSIG",
  theoreticalSignalPrice:sig.entryPrice,asterH1EntryOpen:entryOpen,
  asterH1H48ExitBoundaryOpen:exitOpen,signalReferenceStop:sig.stopPrice,
  signalReferenceTakeProfit:sig.takeProfitPrice,
  sourceProfitReturnOnEntryOpen:exitOpen/entryOpen-1,
  grossModel:1.0,asofFeatures:sig.diagnostics,
  model10bpsUnitGrossReturn:exitOpen/entryOpen-1-0.001,
  model30bpsUnitGrossReturn:exitOpen/entryOpen-1-0.003,
  noSignedExecutionBook:true
 });
}
const out={
 schema:"p107-hype-exact-pinned-native-signal-plus-h48-boundary-price-shadow/v1",
 status:"HYPE_ENTRY_H48_SOURCE_EVALUATION_PASS__NOT_ACCOUNT_BT",
 sourceSha:"e0e4f1d8f22b62e9410188ef6e590a20e31f760f",
 rawH1Bars:hp.length,grids,acceptedCount:accepted.length,rejections:rejected,
 boundaryUnresolvedCount:risk.length,boundaryUnresolved:risk,
 signedVenueFills:0,accountNAV:null,maxDrawdown:null,winRateAccount:null,
 allRunnersSTABLE4FullParity:false,
 riskNotes:["HYPE TIME_ONLY has no resident STOP/TP within authorized policy. Do NOT use to authorize exchange positions.","H1 open is a historical price reference, not proven executable bid/order fill.","No ownership/portfolio gates, Gross, Shared Risk, gap/slippage or Funding in isolated signal scan."],
 accepted
};
fs.writeFileSync(outPath,JSON.stringify(out,null,2)+"\n");
console.log(JSON.stringify({grids,accepted:accepted.length,rejected,researchOnly:true,output:outPath,boundaryUnresolved:risk.length}));
