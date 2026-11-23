import { AsterV3Client, type AsterKline } from "../lib/aster-v3-client";
import { buildV12DecisionObservation, buildV12Signals, resampleV12H1ToH2, type V12Bar } from "../lib/v12-x1-all";
import { V12_X1_ALL } from "../config/v12X1AllRuntime";

const H=3_600_000;
const START=Date.parse("2026-09-10T00:00:00Z");
const END=Date.parse("2026-09-23T10:00:00Z");

const entries=[
  {name:"XRP04",symbol:"XRP",ts:Date.parse("2026-09-22T19:06:20Z"),rank:1,reason:"BLOCK_FALSE_BURST80",allowed:false,referenceEnd:"2026-09-22T18:00:00.000Z"},
  {name:"INJ0840",symbol:"INJ",ts:Date.parse("2026-09-22T23:40:22Z"),rank:1,reason:"BLOCK_RANK1_FAST_E085_REL10",allowed:false,referenceEnd:"2026-09-22T22:00:00.000Z"},
  {name:"XRP0840",symbol:"XRP",ts:Date.parse("2026-09-22T23:40:31Z"),rank:2,reason:"ALLOW_STANDARD",allowed:true,referenceEnd:"2026-09-22T22:00:00.000Z"},
  {name:"LTC13",symbol:"LTC",ts:Date.parse("2026-09-23T04:00:27Z"),rank:1,reason:"ALLOW_STANDARD",allowed:true,referenceEnd:"2026-09-23T04:00:00.000Z"},
  {name:"SOL15",symbol:"SOL",ts:Date.parse("2026-09-23T06:00:31Z"),rank:1,reason:"BLOCK_RANK1_FAST_E085_REL10",allowed:false,referenceEnd:"2026-09-23T06:00:00.000Z"},
  {name:"NEAR17",symbol:"NEAR",ts:Date.parse("2026-09-23T08:00:28Z"),rank:2,reason:"ALLOW_STANDARD",allowed:true,referenceEnd:"2026-09-23T08:00:00.000Z"},
] as const;

function parse(row:AsterKline){
  const ts=Number(row[0]),open=Number(row[1]),high=Number(row[2]),low=Number(row[3]),close=Number(row[4]),volume=Number(row[5]),closeTs=Number(row[6]);
  if(![ts,open,high,low,close,volume,closeTs].every(Number.isFinite)||ts%H!==0||!(open>0&&high>=low&&low>0&&close>0&&volume>=0)) return null;
  return {ts,open,high,low,close,volume,closed:true} as const;
}
function idxAt(b:V12Bar[],ts:number){let out=-1;for(let i=0;i<b.length;i++){if(b[i].endTs<=ts)out=i;else break;}return out;}

async function main(){
  const client=new AsterV3Client({baseUrl:"https://fapi.asterdex.com",requestTimeoutMs:15_000,userAgent:"DisDex-V12-WinRate-Live-Parity/20260923"});
  const rows:{symbol:string;bars:V12Bar[]}[]=[];
  for(const symbol of V12_X1_ALL.universe){
    const raw=await client.getKlines(`${symbol}USDT`,"1h",500,{startTime:START,endTime:END});
    const parsed=raw.map(parse).filter((x):x is NonNullable<ReturnType<typeof parse>>=>Boolean(x));
    rows.push({symbol,bars:resampleV12H1ToH2(parsed)});
    await new Promise(r=>setTimeout(r,120));
  }
  const common=rows.reduce<Set<number>|undefined>((acc,row)=>{
    const set=new Set(row.bars.map(x=>x.endTs));
    return acc?new Set([...acc].filter(x=>set.has(x))):set;
  },undefined);
  if(!common||common.size<80) throw new Error(`COMMON_H2_INSUFFICIENT:${common?.size||0}`);
  const data:Record<string,V12Bar[]>={};
  for(const row of rows)data[row.symbol]=row.bars.filter(x=>common.has(x.endTs));

  const out=[];
  for(const e of entries){
    const i=idxAt(data.BTC,e.ts);
    if(i<0)throw new Error(`NO_INDEX:${e.name}`);
    const referenceEnd=new Date(data.BTC[i].endTs).toISOString();
    if(referenceEnd!==e.referenceEnd)throw new Error(`REFERENCE_BAR_MISMATCH:${e.name}:${referenceEnd}`);
    const observation=buildV12DecisionObservation(data,i,e.ts);
    if(!observation)throw new Error(`OBSERVATION_MISSING:${e.name}`);
    const candidate=observation.candidates.find(x=>x.symbol===e.symbol&&x.side==="LONG");
    if(!candidate)throw new Error(`CANDIDATE_MISSING:${e.name}`);
    if(candidate.portfolioRank!==e.rank)throw new Error(`PORTFOLIO_RANK_MISMATCH:${e.name}:expected=${e.rank}:actual=${candidate.portfolioRank}`);
    if(candidate.entryGateReason!==e.reason)throw new Error(`GATE_REASON_MISMATCH:${e.name}:expected=${e.reason}:actual=${candidate.entryGateReason}`);
    const signals=buildV12Signals(data,i);
    const present=signals.some(x=>x.symbol===e.symbol&&x.side==="LONG"&&x.rank===e.rank);
    if(present!==e.allowed)throw new Error(`GATE_ALLOW_MISMATCH:${e.name}:expected=${e.allowed}:actual=${present}`);
    out.push({name:e.name,symbol:e.symbol,rank:e.rank,reason:e.reason,allowed:e.allowed,referenceEnd,selectedSignals:signals.map(x=>({symbol:x.symbol,rank:x.rank,quality:x.entryQualityClass,multiplier:x.entryGrossMultiplier,gate:x.entryGateReason}))});
  }
  console.log(JSON.stringify({status:"PASS_V12_WINRATE_GATE_LIVE_PARITY",out},null,2));
}
main().catch(e=>{console.error(e);process.exit(1);});
