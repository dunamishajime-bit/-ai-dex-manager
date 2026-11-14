import { DISDEX_STABLE4_OPPORTUNITY } from "../config/disdexStable4Opportunity";

export type Stable4HypeCandle = { ts: number; open: number; high: number; low: number; close: number };

export type Stable4HypeSignal = {
  accepted: boolean;
  strategy: "HYPE_LONG";
  symbol: "HYPEUSDT";
  side: "LONG";
  signalTs: number | null;
  entryPrice: number | null;
  stopPrice: number | null;
  takeProfitPrice: number | null;
  reason: string;
  diagnostics?: { h12: number; h24: number; btc24: number; rel24: number; entryTs: number };
};

const HOUR=3_600_000;
const SIX_HOURS=6*HOUR;

function ret(rows: readonly Stable4HypeCandle[], index: number, hours: number) {
  const j=index-hours;
  if(j<0)return undefined;
  const a=rows[j]?.close,b=rows[index]?.close;
  return a&&b&&a>0&&b>0?b/a-1:undefined;
}

export function evaluateStable4HypeSignal(input:{now:number;btc1h:readonly Stable4HypeCandle[];hype1h:readonly Stable4HypeCandle[]}):Stable4HypeSignal{
  const reject=(reason:string):Stable4HypeSignal=>({accepted:false,strategy:"HYPE_LONG",symbol:"HYPEUSDT",side:"LONG",signalTs:null,entryPrice:null,stopPrice:null,takeProfitPrice:null,reason});
  const btc=[...input.btc1h].sort((a,b)=>a.ts-b.ts);
  const hype=[...input.hype1h].sort((a,b)=>a.ts-b.ts);
  const btcByTs=new Map(btc.map(x=>[x.ts,x]));
  const rows=hype.filter(x=>btcByTs.has(x.ts));
  if(rows.length<25)return reject("STABLE4_HYPE_INSUFFICIENT_H1");
  const last=rows.at(-1)!;
  const index=rows.length-1;
  const entryTs=last.ts+HOUR;
  if(entryTs%SIX_HOURS!==0)return reject("STABLE4_HYPE_NOT_6H_ENTRY_BOUNDARY");
  if(input.now<entryTs||input.now-entryTs>20*60_000)return reject("STABLE4_HYPE_ENTRY_WINDOW_CLOSED");
  const btcIndex=btc.findIndex(x=>x.ts===last.ts);
  if(btcIndex<24)return reject("STABLE4_HYPE_BTC_HISTORY_MISSING");
  const h12=ret(rows,index,12),h24=ret(rows,index,24),btc24=ret(btc,btcIndex,24);
  if(h12===undefined||h24===undefined||btc24===undefined)return reject("STABLE4_HYPE_FEATURE_MISSING");
  const rel24=h24-btc24;
  const p=DISDEX_STABLE4_OPPORTUNITY.hype;
  if(!(h12<=p.h12Max&&h24>=p.h24Min&&rel24<=p.rel24Max))return reject("STABLE4_HYPE_GATE_WAIT");
  const entryPrice=last.close;
  return {accepted:true,strategy:"HYPE_LONG",symbol:"HYPEUSDT",side:"LONG",signalTs:entryTs,entryPrice,
    stopPrice:entryPrice*(1-p.emergencyStopPct),takeProfitPrice:entryPrice*(1+p.protectionTakeProfitPct),
    reason:"STABLE4_HYPE_H48R4_WSIG",diagnostics:{h12,h24,btc24,rel24,entryTs}};
}
export const STABLE4_HYPE_FORMAL_STRATEGIES = new Set(["V12","QUALITY102","QUALITY102_CAUSAL_V1","PENGU_DUAL_LS_V2","FET_RESIDUAL","V11_EQ","V50_POST_OPEN_BASIS"]);
export function stable4HypeFormalPriorityOpen(strategies:readonly string[]){return strategies.some(x=>STABLE4_HYPE_FORMAL_STRATEGIES.has(x));}
