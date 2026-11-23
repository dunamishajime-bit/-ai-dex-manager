/**
 * Offline only, explicit fixture plans/fills. No orders, account reads, environment secrets or network.
 * Usage: tsx scripts/v12-v4-production-offline.ts INPUT.json OUTPUT.json
 * Restart: put the previous output's initial+journal in INPUT and supply additional actions.
 * Output is an atomic checkpoint of the complete journal; intent consumption requires that checkpoint.
 */
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createProductionState, replayProductionJournal, applyProductionEvent, planProductionEntry,
  productionSnapshot, type InitialState, type Event } from "../lib/v12-v4-production-lifecycle";
import { adaptProductionCandidates } from "../lib/v12-v4-production-features";
import { certifyV4Production } from "../lib/v12-v4-production-certification";

export async function evaluateOfflineInput(input:any) {
  if(input.policyId!==undefined&&input.policyId!=="V2_M150_D05_CORE_NATIVE")throw Error("OFFLINE_POLICY_MISMATCH");
  function denyAuthority(value:any):void {
    if(!value||typeof value!=="object")return;
    for(const [key,v] of Object.entries(value)) {
      if((["orderEnabled","liveExecutionEnabled","liveTradingEnabled"].includes(key)&&v!==false&&v!==undefined)||
        (["realOrderEnabledV4","tradingMutation"].includes(key)&&v!==0&&v!==undefined)||
        (key==="mode"&&String(v).toUpperCase()==="LIVE"))throw Error("OFFLINE_ORDER_AUTHORITY_FORBIDDEN");
      denyAuthority(v);
    }
  }
  denyAuthority(input);
  const state0=input.journal?replayProductionJournal(input.initial as InitialState,input.journal as Event[]):
    createProductionState(input.initial);
  let state=state0;
  const featureAudits:any[]=[];
  for(const action of input.actions??[]) {
    if(action.type==="CANDIDATES") {
      const out=adaptProductionCandidates(action.input);
      featureAudits.push(out);
    } else if(action.type==="PLAN") {
      const catalog=featureAudits.at(-1)?.candidates??[];
      const candidate=catalog.find((c:any)=>c.route===action.route&&c.symbol===action.symbol&&c.eligibleEntryTs===action.ts);
      if(!candidate)throw Error("PLAN_REQUIRES_CAUSAL_CANDIDATE_ADAPTER");
      const filters=input.venueFilters?.[candidate.symbol];
      if(!filters || ![filters.stepSize,filters.minQty,filters.minNotional].every((n:number)=>Number.isFinite(n)&&n>0))
        throw Error("OFFLINE_VENUE_FILTERS_REQUIRED");
      const quantityNormalizer:any={normalizeMarketQuantity:async(symbol:string,q:number,price:number)=>{
        const units=Math.floor((q+1e-12)/filters.stepSize);
        const quantity=Number((units*filters.stepSize).toPrecision(15));
        if(quantity<filters.minQty-1e-12||quantity*price<filters.minNotional-1e-9||
          (filters.maxQty!==undefined&&quantity>filters.maxQty))throw Error("OFFLINE_VENUE_QUANTITY_FILTER");
        return {symbol,quantity,stepSize:filters.stepSize,notional:quantity*price};
      }};
      if(!Number.isFinite(action.referencePrice)||action.referencePrice<=0)throw Error("OFFLINE_REFERENCE_PRICE_REQUIRED");
      // Lift minimums to a realizable venue step before applying the catalog 0.30x lift ceiling.
      const minUnits=Math.ceil(Math.max(filters.minQty,filters.minNotional/action.referencePrice)/filters.stepSize-1e-12);
      const realizableMinimumUsd=minUnits*filters.stepSize*action.referencePrice;
      const event=await planProductionEntry(state,{candidate,ts:action.ts,eventId:action.eventId,
        referencePrice:action.referencePrice,minimumOrderNotionalUsd:Math.max(filters.minNotional,realizableMinimumUsd),
        quantityNormalizer,entryAtr:action.entryAtr,nativeExitEvidence:action.nativeExitEvidence});
      state=applyProductionEvent(state,event);
    } else {
      // Fills are explicit journal evidence, never fabricated from planned quantity.
      state=applyProductionEvent(state,action as Event);
    }
  }
  const signalEntryTimesMs=Object.values(state.legs).map(l=>l.entryTs);
  // Proof attachments cannot replace the policy, journal clock, or evaluated leg entry times.
  const certification=certifyV4Production({...input.certificationEvidence,
    policyId:"V2_M150_D05_CORE_NATIVE",evaluatedAtMs:Math.max(state.journal.at(-1)?.ts??0,...signalEntryTimesMs),signalEntryTimesMs});
  return {...productionSnapshot(state),featureAudits,certification,
    executionMode:"OFFLINE_EXPLICIT_FIXTURE_FILLS" as const,
    nativeSignalGeneratorCertified:false as const, venueExecutionCertified:false as const};
}
async function main() {
  const [inputPath,outputPath]=process.argv.slice(2);
  if(!inputPath||!outputPath)throw Error("USAGE: INPUT.json OUTPUT.json");
  const target=resolve(outputPath);
  // Refuse accidental overwrite of an existing evidence file. Restart always creates a new checkpoint.
  if(existsSync(target))throw Error("OUTPUT_CHECKPOINT_ALREADY_EXISTS");
  const result=await evaluateOfflineInput(JSON.parse(readFileSync(resolve(inputPath),"utf8")));
  const temp=target+".tmp-"+process.pid;
  writeFileSync(temp,JSON.stringify(result,null,2)+"\n",{flag:"wx"});
  renameSync(temp,target);
  process.stdout.write(JSON.stringify({ok:true,executionMode:result.executionMode,orderEnabled:false,
    realOrderEnabledV4:0,tradingMutation:0,eventCount:result.journal.length,output:target})+"\n");
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url)))
  main().catch(e=>{process.stderr.write(String(e.message)+"\n");process.exitCode=1;});
