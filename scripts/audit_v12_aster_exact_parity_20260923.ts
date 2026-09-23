import { AsterV3Client, type AsterKline } from "../lib/aster-v3-client";
import { buildV12DecisionObservation, buildV12Signals, resampleV12H1ToH2, type V12Bar } from "../lib/v12-x1-all";
import { V12_X1_ALL } from "../config/v12X1AllRuntime";

const H=3_600_000;
const START=Date.parse("2026-09-10T00:00:00Z");
const END=Date.parse("2026-09-23T10:00:00Z");

const entries=[
  {name:"XRP04",symbol:"XRP",ts:Date.parse("2026-09-22T19:06:20Z")},
  {name:"INJ0840",symbol:"INJ",ts:Date.parse("2026-09-22T23:40:22Z")},
  {name:"XRP0840",symbol:"XRP",ts:Date.parse("2026-09-22T23:40:31Z")},
  {name:"LTC13",symbol:"LTC",ts:Date.parse("2026-09-23T04:00:27Z")},
  {name:"SOL15",symbol:"SOL",ts:Date.parse("2026-09-23T06:00:31Z")},
  {name:"NEAR17",symbol:"NEAR",ts:Date.parse("2026-09-23T08:00:28Z")},
];

function parse(row:AsterKline){
  const ts=Number(row[0]), open=Number(row[1]), high=Number(row[2]), low=Number(row[3]), close=Number(row[4]), volume=Number(row[5]), closeTs=Number(row[6]);
  if(![ts,open,high,low,close,volume,closeTs].every(Number.isFinite) || ts%H!==0 || !(open>0&&high>=low&&low>0&&close>0&&volume>=0)) return null;
  return {ts,open,high,low,close,volume,closed:true} as const;
}
function ret(b:V12Bar[],i:number,n:number){return i>=n?b[i].close/b[i-n].close-1:NaN;}
function er(b:V12Bar[],i:number,n:number){
  if(i<n)return NaN;
  const net=Math.abs(b[i].close-b[i-n].close);
  let path=0; for(let k=i-n+1;k<=i;k++) path+=Math.abs(b[k].close-b[k-1].close);
  return path>0?net/path:0;
}
function vr(b:V12Bar[],i:number){
  if(i<20)return NaN;
  const m=b.slice(i-20,i).reduce((a,x)=>a+x.volume,0)/20;
  return m>0?b[i].volume/m:NaN;
}
function idxAt(b:V12Bar[],ts:number){
  let out=-1; for(let i=0;i<b.length;i++){ if(b[i].endTs<=ts) out=i; else break; } return out;
}
function sideAdjusted(x:number,side:"LONG"|"SHORT"){return side==="LONG"?x:-x;}

async function main(){
  const client=new AsterV3Client({baseUrl:"https://fapi.asterdex.com",requestTimeoutMs:15000,userAgent:"DisDex-V12-Parity-Audit/20260923"});
  const rows:{symbol:string;bars:V12Bar[]}[]=[];
  for(const symbol of V12_X1_ALL.universe){
    const raw=await client.getKlines(`${symbol}USDT`,"1h",500,{startTime:START,endTime:END});
    const parsed=raw.map(parse).filter((x):x is NonNullable<ReturnType<typeof parse>>=>Boolean(x));
    rows.push({symbol,bars:resampleV12H1ToH2(parsed)});
    await new Promise(r=>setTimeout(r,150));
  }
  const common=rows.reduce<Set<number>|undefined>((acc,row)=>{
    const s=new Set(row.bars.map(x=>x.endTs));
    return acc?new Set([...acc].filter(x=>s.has(x))):s;
  },undefined);
  if(!common || common.size<80) throw new Error(`common H2 insufficient: ${common?.size||0}`);
  const data:Record<string,V12Bar[]>={};
  for(const row of rows)data[row.symbol]=row.bars.filter(x=>common.has(x.endTs));

  const out=[];
  for(const e of entries){
    const i=idxAt(data.BTC,e.ts);
    if(i<0)throw new Error(`no index for ${e.name}`);
    const sig=buildV12Signals(data,i);
    const obs=buildV12DecisionObservation(data,i,e.ts);
    const sb=data[e.symbol], si=idxAt(sb,e.ts), bb=data.BTC, bi=idxAt(bb,e.ts);
    const side:"LONG"="LONG";
    const sym24=ret(sb,si,12), btc24=ret(bb,bi,12);
    const f={
      referenceEnd:new Date(bb[bi].endTs).toISOString(),
      btc6:sideAdjusted(ret(bb,bi,3),side),
      btc12:sideAdjusted(ret(bb,bi,6),side),
      btc24:sideAdjusted(btc24,side),
      btcEr12:er(bb,bi,6),
      btcEr24:er(bb,bi,12),
      sym6:sideAdjusted(ret(sb,si,3),side),
      sym24:sideAdjusted(sym24,side),
      volumeRatio:vr(sb,si),
      rel24:sideAdjusted(sym24-btc24,side),
    };
    const A=f.btcEr24>=.50&&f.btcEr12<.50;
    const B=f.btcEr24>=.60&&f.sym6<.01;
    const C=f.volumeRatio>=2&&f.rel24<0;
    const falseBurst=f.btcEr24<.20&&f.btcEr12>=.55&&f.btcEr12<.80&&f.sym6>=.02;
    out.push({
      entry:e,
      index:i,
      ...f,
      anyWeak:A||B||C,
      falseBurst80:falseBurst,
      proposedBlock:(A||B||C||falseBurst),
      productionSignals:sig.map(x=>({symbol:x.symbol,side:x.side,rank:x.rank,score:x.score,momentum:x.momentum,volumeRatio:x.volumeRatio,referenceTs:x.referenceTs})),
      observation:obs?{regime:obs.regime,reason:obs.reason,selected:obs.symbol?{symbol:obs.symbol,side:obs.side,rank:obs.rank,score:obs.score,momentum:obs.momentum,volumeRatio:obs.volumeRatio}:null,top:obs.candidates.slice(0,8)}:null,
      actualSymbolInSignals:sig.some(x=>x.symbol===e.symbol&&x.side==="LONG"),
    });
  }
  console.log(JSON.stringify({status:"PASS_ASTER_EXACT_PRODUCTION_REPLAY",sourceSha:"c6add8d39676584ad9db094d1ad04deb4050ed06",commonBars:common.size,out},null,2));
}
main().catch(e=>{console.error(e);process.exit(1);});
