import fs from "node:fs";
import path from "node:path";
import { V12_X1_ALL } from "../config/v12X1AllRuntime";
import { resampleV12H1ToH2, buildV12Signals, protectiveLevels, nextTrailingStop } from "../lib/v12-x1-all";

const H=3_600_000;
const TRAIL=Number(process.env.V12_TRAIL_ATR || "0.4");
const START=Date.UTC(2026,7,10), END=Date.UTC(2026,9,1);
const ROOT="C:\\Users\\dis\\Desktop\\bt-analysis-formal\\v12_fresh_oos_all";
const SYMS=[...V12_X1_ALL.universe];
type Pos={symbol:string;side:"LONG"|"SHORT";entry:number;atr:number;stop:number;initialStop:number;tp:number;trail:number;peak:number;trough:number;bars:number;rank:number;entryTs:number};
type Trade={symbol:string;side:string;rank:number;entryTs:number;exitTs:number;reason:string;netReturn:number};
const universe:any={};
for(const s of SYMS){
 const rows=fs.readFileSync(path.join(ROOT,s+"USDT.jsonl"),"utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
 universe[s]=resampleV12H1ToH2(rows);
}
const timeline=universe.BTC as any[];
const pos=new Map<string,Pos>(), pending=new Map<string,any>(), exits=new Map<string,string>(), cool=new Map<string,number>();
const trades:Trade[]=[];
function close(q:Pos,px:number,reason:string,ts:number){
 const raw=q.side==="LONG"?px/q.entry-1:q.entry/px-1;
 trades.push({symbol:q.symbol,side:q.side,rank:q.rank,entryTs:q.entryTs,exitTs:ts,reason,netReturn:raw-0.001});
 pos.delete(q.symbol);exits.delete(q.symbol);cool.set(q.symbol,ts+V12_X1_ALL.cooldownBars*2*H);
}
for(let i=0;i<timeline.length;i++){
 const bar=timeline[i],t=bar.ts;
 if(t<START-2*H||t>=END) continue;
 for(const [s,reason] of [...exits]){
  const q=pos.get(s),b=universe[s]?.[i]; if(q&&b)close(q,b.open,reason,t); exits.delete(s);
 }
 for(const [s,x] of [...pending]){
  const b=universe[s]?.[i]; if(!b){pending.delete(s);continue;}
  if(pos.size>=V12_X1_ALL.maximumPositions||pos.has(s)||(cool.get(s)||0)>t){pending.delete(s);continue;}
  const entry=b.open,lev=protectiveLevels(entry,x.atr,x.side);
  pos.set(s,{symbol:s,side:x.side,entry,atr:x.atr,stop:lev.initialStop,initialStop:lev.initialStop,tp:lev.takeProfit,trail:x.atr*TRAIL,peak:entry,trough:entry,bars:0,rank:x.rank,entryTs:t});pending.delete(s);
 }
 for(const q of [...pos.values()]){
  const b=universe[q.symbol]?.[i]; if(!b)continue; q.bars++;
  if(q.side==="LONG"){
   if(b.low<=q.stop){close(q,q.stop,q.stop>q.initialStop?"trail":"stop",t);continue;}
   if(b.high>=q.tp){close(q,q.tp,"tp",t);continue;}
  }else{
   if(b.high>=q.stop){close(q,q.stop,q.stop<q.initialStop?"trail":"stop",t);continue;}
   if(b.low<=q.tp){close(q,q.tp,"tp",t);continue;}
  }
  q.peak=Math.max(q.peak,b.high);q.trough=Math.min(q.trough,b.low);
  q.stop=nextTrailingStop(q.side,q.stop,q.side==="LONG"?q.peak:q.trough,q.trail);
 }
 if(t<START)continue;
 const sigs=buildV12Signals(universe,i,V12_X1_ALL.maximumPositions);
 const keys=new Set(sigs.map((x:any)=>x.symbol+":"+x.side));
 for(const q of pos.values()){
  if(q.bars>=V12_X1_ALL.maxHoldBars)exits.set(q.symbol,"max-hold");
  else if(q.bars>=V12_X1_ALL.rebalanceBars&&!keys.has(q.symbol+":"+q.side))exits.set(q.symbol,"rotation");
 }
 let slots=Math.max(0,V12_X1_ALL.maximumPositions-[...pos.keys()].filter(s=>!exits.has(s)).length-pending.size);
 for(const x of sigs){if(slots<=0)break;if(pos.has(x.symbol)&&!exits.has(x.symbol)||pending.has(x.symbol)||(cool.get(x.symbol)||0)>t)continue;pending.set(x.symbol,x);slots--;}
}
const lastI=Math.min(timeline.length-1,Math.floor((END-timeline[0].ts)/(2*H)));
for(const q of [...pos.values()]){const b=universe[q.symbol]?.[lastI];if(b)close(q,b.close,"end",END);}
function stat(a:Trade[]){const z=a.map(x=>x.netReturn),gp=z.filter(x=>x>0).reduce((a,b)=>a+b,0),gl=-z.filter(x=>x<0).reduce((a,b)=>a+b,0);return {n:z.length,wins:z.filter(x=>x>0).length,wr:z.length?z.filter(x=>x>0).length/z.length:0,pf:gl?gp/gl:gp?999:0,ret:z.reduce((a,b)=>a+b,0)}}
const ltc=trades.filter(x=>x.symbol==="LTC");
const byReg:any={all:stat(trades),ltc:stat(ltc),ltcTrades:ltc};
const out="C:\\Users\\dis\\Desktop\\bt-analysis-formal\\v12_ltc_fresh_oos_result.json";
fs.writeFileSync(out,JSON.stringify(byReg,null,2)+"\n");
console.log(JSON.stringify({period:[new Date(START).toISOString(),new Date(END).toISOString()],all:byReg.all,ltc:byReg.ltc,ltcTrades:ltc},null,2));
