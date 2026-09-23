import { V12_X1_ALL } from "../config/v12X1AllRuntime";
import { buildV12Signals, computeV12Regime, resampleV12H1ToH2, type V12Bar } from "../lib/v12-x1-all";

const H=3600000;
const entries=[
 {name:"XRP04",symbol:"XRP",ts:Date.parse("2026-09-22T19:06:20Z")},
 {name:"INJ0840",symbol:"INJ",ts:Date.parse("2026-09-22T23:40:22Z")},
 {name:"XRP0840",symbol:"XRP",ts:Date.parse("2026-09-22T23:40:31Z")},
 {name:"LTC13",symbol:"LTC",ts:Date.parse("2026-09-23T04:00:27Z")},
 {name:"SOL15",symbol:"SOL",ts:Date.parse("2026-09-23T06:00:31Z")},
 {name:"NEAR17",symbol:"NEAR",ts:Date.parse("2026-09-23T08:00:28Z")},
];
async function h1(symbol:string){
 const inst=symbol+"-USDT-SWAP";
 const u="https://www.okx.com/api/v5/market/candles?instId="+inst+"&bar=1H&limit=300";
 const r=await fetch(u); if(!r.ok) throw new Error(inst+" "+r.status);
 const j:any=await r.json(); if(j.code!=="0")throw new Error(inst+" "+JSON.stringify(j));
 return j.data.map((x:any[])=>({ts:+x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],volume:+x[5],closed:x[8]==="1"})).sort((a:any,b:any)=>a.ts-b.ts);
}
const universe:Record<string,V12Bar[]>={};
for(const s of V12_X1_ALL.universe){
 try{universe[s]=resampleV12H1ToH2(await h1(s));}
 catch(e){console.error("FETCH_FAIL",s,String(e));universe[s]=[];}
}
function route(sig:any,idx:number){
 if(sig.score>=V12_X1_ALL.neutralScoreThreshold)return "NORMAL_SCORE";
 const btc=universe.BTC, sb=universe[sig.symbol];
 const slice=btc.slice(idx-V12_X1_ALL.btcRegimeSmaBars+1,idx+1);
 const ma=slice.reduce((a,x)=>a+x.close,0)/slice.length;
 const dist=btc[idx].close/ma-1;
 const strong=Math.abs(dist)>=V12_X1_ALL.strongRegimeThresholdPct;
 const atrRatio=sig.atr/sb[idx].close;
 if(strong&&sig.score>=V12_X1_ALL.strongRegimeQualityScoreMinimum&&sig.score<=V12_X1_ALL.strongRegimeQualityScoreMaximum&&atrRatio>=V12_X1_ALL.strongRegimeQualityMinimumAtrRatio)return "STRONG_REGIME_ALT";
 const aligned=sig.side==="LONG"?sig.momentum:-sig.momentum;
 if(aligned>=V12_X1_ALL.relaxedRegimeMinimumMomentumPct&&atrRatio>=V12_X1_ALL.relaxedRegimeMinimumAtrRatio)return "RELAXED_MOMENTUM_ALT";
 return "UNKNOWN";
}
for(const e of entries){
 const btc=universe.BTC;
 let idx=-1;
 for(let i=0;i<btc.length;i++)if(btc[i].endTs<=e.ts)idx=i;
 const sigs=idx>=0?buildV12Signals(universe,idx,V12_X1_ALL.maximumPositions):[];
 const sig=sigs.find(x=>x.symbol===e.symbol);
 const all=sigs.map(x=>({symbol:x.symbol,side:x.side,rank:x.rank,score:x.score,momentum:x.momentum,volumeRatio:x.volumeRatio,regime:x.regime,route:route(x,idx)}));
 console.log(JSON.stringify({entry:e,referenceEnd:idx>=0?new Date(btc[idx].endTs).toISOString():null,btcRegime:idx>=0?computeV12Regime(btc,idx):null,selected:sig?{symbol:sig.symbol,side:sig.side,rank:sig.rank,score:sig.score,momentum:sig.momentum,volumeRatio:sig.volumeRatio,regime:sig.regime,route:route(sig,idx)}:null,top:all}));
}