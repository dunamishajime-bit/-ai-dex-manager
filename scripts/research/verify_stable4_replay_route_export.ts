/** Offline reproducibility guard for local STABLE4 research replay exports; no I/O to venue. */
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {validateReplay} from "../../lib/bt-verification/replay";

function check(exportDirectory:string):void {
 const manifest=JSON.parse(readFileSync(join(exportDirectory,"MANIFEST_UNCERTIFIED.json"),"utf8")) as {
  schema:string;production_parity_verified:boolean;integrated_eight_runner:boolean;
  actual_exchange_fills_verified:boolean;exports:Array<{bps:number;file:string;sha256:string}>;
 };
 if(manifest.schema!=="disdex-private-stable4-research-replays/v1"||
    manifest.production_parity_verified!==false||
    manifest.integrated_eight_runner!==false||
    manifest.actual_exchange_fills_verified!==false||
    manifest.exports.length!==2||
    manifest.exports.map(x=>x.bps).sort().join(",")!=="10,30")
   throw new Error("PRIVATE_RESEARCH_MANIFEST_NOT_UNCERTIFIED");
 for(const entry of manifest.exports){
  const expectedName="disdex-baseline-STABLE4-research-"+entry.bps+"bps-UNCERTIFIED.json";
  if(entry.file!==expectedName||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error("RESEARCH_FILE_IN_MANIFEST_INVALID");
  const content=readFileSync(join(exportDirectory,entry.file));
  const digest=createHash("sha256").update(content).digest("hex");
  if(digest!==entry.sha256)throw Error("STABLE4_REPLAY_SHA256_MISMATCH");
  const candidate:unknown=JSON.parse(content.toString("utf-8"));
  if(!validateReplay(candidate))throw Error("STABLE4_REPLAY_FORMAT_INVALID");
  if(candidate.mode!=="EXTERNAL"||
     candidate.source?.kind!=="HISTORICAL_STABLE4_RESEARCH_NOT_PRODUCTION"||
     candidate.engineSha!=="STABLE4_RESEARCH_SOURCE_ONLY_NOT_PRODUCTION_CERTIFIED"||
     !candidate.strategyRouteStats?.length||
     !candidate.researchSummary||
     candidate.researchSummary.costBps!==entry.bps)
    throw Error("STABLE4_RESEARCH_UNCERTIFIED_SOURCE_REQUIRED");
  const closed=candidate.strategyRouteStats.reduce((sum,x)=>sum+x.closedCount,0);
  const terminal=candidate.strategyRouteStats.reduce((sum,x)=>sum+x.tradeCount-x.closedCount,0);
  if(closed!==candidate.researchSummary.modelFills||terminal!==(candidate.terminalModelPositions?.length??0))
    throw Error("ROUTE_MODEL_CLOSED_OR_TERMINAL_COUNT_MISMATCH");
  const perSymbol=new Map<string,{closed:number;trades:number}>();
  for(const row of candidate.strategyRouteStats){
    const key=JSON.stringify([row.logic,row.symbol]);
    const totals=perSymbol.get(key)??{closed:0,trades:0};
    totals.closed+=row.closedCount;totals.trades+=row.tradeCount;
    perSymbol.set(key,totals);
  }
  for(const stat of candidate.strategyStats??[]){
    const totals=perSymbol.get(JSON.stringify([stat.logic,stat.symbol]));
    if(!totals||totals.closed!==stat.closedCount||totals.trades!==stat.tradeCount)
      throw Error("ROUTE_STATS_STRATEGY_SYMBOL_MISMATCH");
  }
  console.log("VALIDATED_UNCERTIFIED_STABLE4_"+entry.bps+"BPS routes="+candidate.strategyRouteStats.length+" exits="+closed+" terminal="+terminal);
 }
 console.log("PRIVATE_STABLE4_REPLAY_VERIFICATION_PASS_NO_LIVE_CERTIFICATION");
}

if(!process.argv[2])throw Error("USAGE: tsx scripts/research/verify_stable4_replay_route_export.ts <private-export-dir>");
check(process.argv[2]);
