import fs from "node:fs/promises";
import path from "node:path";
import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";
import type { PerpBar, PerpMarketData, PerpSide } from "../lib/research-lab/perp/types";

const H = 3_600_000;
const BAR = 2 * H;
const STUDY_START = Date.UTC(2023, 0, 1);
const CURRENT_START = Date.UTC(2025, 7, 1);
const END = Date.UTC(2026, 7, 1);
const WARM = STUDY_START - 180 * 24 * H;
const SYMS = ["ETH", "BNB", "SOL", "LINK", "AVAX", "DOGE", "INJ", "XRP", "ADA", "LTC", "ATOM", "AAVE", "NEAR"];
const ALL = ["BTC", ...SYMS];
const GROSS = 0.50;

type Prepared = { bars: Record<string, PerpBar[]>; idx: Record<string, Map<number, number>>; timeline: number[] };
type Family = { id: string; kind: "MR" | "BREAKOUT"; atrMultiple: number; maxBars: number };
type Trade = { family: string; symbol: string; side: PerpSide; signalTs: number; entryTs: number; exitTs: number; requestedGross: number; netUnitReturn: number; exitReason: string; rank: number };

const FAMILIES: Family[] = [
  { id: "NEUTRAL_MR_1P5ATR_REV", kind: "MR", atrMultiple: 1.5, maxBars: 6 },
  { id: "NEUTRAL_MR_2P0ATR_REV", kind: "MR", atrMultiple: 2.0, maxBars: 8 },
  { id: "NEUTRAL_COMPRESSION_BREAKOUT", kind: "BREAKOUT", atrMultiple: 1.5, maxBars: 8 },
];

function mean(a: number[]) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN; }
function sma(b: PerpBar[], i: number, n: number) { return i >= n - 1 ? mean(b.slice(i - n + 1, i + 1).map(x => x.close)) : NaN; }
function mom(b: PerpBar[], i: number, n: number) { return i >= n ? b[i].close / b[i - n].close - 1 : NaN; }
function atr(b: PerpBar[], i: number, n: number) {
  if (i < n) return NaN;
  const a: number[] = [];
  for (let j = i - n + 1; j <= i; j += 1) a.push(Math.max(b[j].high - b[j].low, Math.abs(b[j].high - b[j - 1].close), Math.abs(b[j].low - b[j - 1].close)));
  return mean(a);
}
function vr(b: PerpBar[], i: number, n = 20) {
  if (i < n) return NaN;
  const m = mean(b.slice(i - n, i).map(x => x.volume));
  return m > 0 ? b[i].volume / m : NaN;
}
function resample(a: PerpBar[]) {
  const out = new Map<number, PerpBar>();
  for (const x of a) {
    const ts = Math.floor(x.ts / BAR) * BAR;
    const e = out.get(ts);
    if (!e) out.set(ts, { ...x, ts });
    else { e.high = Math.max(e.high, x.high); e.low = Math.min(e.low, x.low); e.close = x.close; e.volume += x.volume; }
  }
  return [...out.values()].sort((a, b) => a.ts - b.ts);
}
function prep(d: PerpMarketData): Prepared {
  const bars: Record<string, PerpBar[]> = {};
  const idx: Record<string, Map<number, number>> = {};
  for (const [s, a] of Object.entries(d.bySymbol)) { bars[s] = resample(a); idx[s] = new Map(bars[s].map((x, i) => [x.ts, i])); }
  return { bars, idx, timeline: (bars.BTC || []).map(x => x.ts) };
}
function firstFund(a: {ts:number; rate:number}[], ts:number) { let l=0,r=a.length; while(l<r){const m=(l+r)>>1;if(a[m].ts<=ts)l=m+1;else r=m;} return l; }
function funding(a:{ts:number;rate:number}[], from:number,to:number){let i=firstFund(a,from),x=0;for(;i<a.length&&a[i].ts<=to;i+=1)x+=a[i].rate;return x;}
function neutral(p: Prepared, ts: number) {
  const i = p.idx.BTC?.get(ts); const b = p.bars.BTC; if (i == null || !b) return false;
  const s = sma(b, i, 53); const m = mom(b, i, 52); if (![s,m].every(Number.isFinite)) return false;
  const dist = b[i].close / s - 1;
  return !(dist >= 0.0377 && m > 0) && !(dist <= -0.0377 && m < 0);
}
function rawSignal(p: Prepared, family: Family, ts: number): {symbol:string; side:PerpSide; atr:number; score:number} | null {
  if (!neutral(p, ts)) return null;
  const candidates: Array<{symbol:string;side:PerpSide;atr:number;score:number}> = [];
  for (const symbol of SYMS) {
    const i = p.idx[symbol]?.get(ts); const b = p.bars[symbol]; if (i == null || !b || i < 65) continue;
    const a = atr(b, i, 20); const s20 = sma(b, i, 20); const volr = vr(b, i, 20);
    if (![a,s20,volr].every(Number.isFinite) || a <= 0) continue;
    if (family.kind === "MR") {
      const distAtr = (b[i].close - s20) / a;
      const reversalLong = b[i].close > b[i].open && b[i].close > b[i-1].close;
      const reversalShort = b[i].close < b[i].open && b[i].close < b[i-1].close;
      if (distAtr <= -family.atrMultiple && reversalLong && volr >= 0.50 && volr <= 1.75) candidates.push({symbol,side:"long",atr:a,score:-distAtr});
      if (distAtr >= family.atrMultiple && reversalShort && volr >= 0.50 && volr <= 1.75) candidates.push({symbol,side:"short",atr:a,score:distAtr});
    } else {
      const atrSeries:number[]=[]; for(let j=i-39;j<=i;j+=1) atrSeries.push(atr(b,j,20));
      const atrMean=mean(atrSeries.filter(Number.isFinite));
      const prior=b.slice(i-12,i); if(prior.length!==12||!Number.isFinite(atrMean)) continue;
      const compressed=a <= 0.80*atrMean;
      if (compressed && volr >= 1.25 && b[i].close > Math.max(...prior.map(x=>x.high))) candidates.push({symbol,side:"long",atr:a,score:volr});
      if (compressed && volr >= 1.25 && b[i].close < Math.min(...prior.map(x=>x.low))) candidates.push({symbol,side:"short",atr:a,score:volr});
    }
  }
  return candidates.sort((a,b)=>b.score-a.score||a.symbol.localeCompare(b.symbol))[0] || null;
}
function buildTrades(d: PerpMarketData, p: Prepared, family: Family, stress: boolean): Trade[] {
  const fee = (stress ? 10 : 5) / 10000;
  const slip = (stress ? 5 : 0) / 10000;
  const out: Trade[] = [];
  let blockedUntil = STUDY_START;
  for (const ts of p.timeline) {
    if (ts < STUDY_START || ts >= END || ts < blockedUntil) continue;
    const sig = rawSignal(p, family, ts); if (!sig) continue;
    const i = p.idx[sig.symbol]?.get(ts); const b = p.bars[sig.symbol]; if (i == null || !b || i + 1 >= b.length) continue;
    const entryBar = b[i+1]; if (entryBar.ts >= END) continue;
    const entryRaw = entryBar.open;
    const entry = sig.side === "long" ? entryRaw*(1+slip) : entryRaw*(1-slip);
    const stop = sig.side === "long" ? entryRaw - 1.5*sig.atr : entryRaw + 1.5*sig.atr;
    const target = family.kind === "BREAKOUT" ? (sig.side === "long" ? entryRaw + 2*sig.atr : entryRaw - 2*sig.atr) : NaN;
    let exitTs=entryBar.ts, exitRaw=entryBar.close, reason="time";
    for(let k=i+1;k<=Math.min(b.length-1,i+family.maxBars);k+=1){
      const bar=b[k]; const s20=sma(b,k,20);
      if(sig.side==="long"){
        if(bar.low<=stop){exitTs=bar.ts;exitRaw=stop;reason="stop";break;}
        if(family.kind==="MR"&&Number.isFinite(s20)&&bar.high>=s20){exitTs=bar.ts;exitRaw=s20;reason="mean";break;}
        if(family.kind==="BREAKOUT"&&bar.high>=target){exitTs=bar.ts;exitRaw=target;reason="target";break;}
      }else{
        if(bar.high>=stop){exitTs=bar.ts;exitRaw=stop;reason="stop";break;}
        if(family.kind==="MR"&&Number.isFinite(s20)&&bar.low<=s20){exitTs=bar.ts;exitRaw=s20;reason="mean";break;}
        if(family.kind==="BREAKOUT"&&bar.low<=target){exitTs=bar.ts;exitRaw=target;reason="target";break;}
      }
      exitTs=bar.ts;exitRaw=bar.close;
    }
    const exit = sig.side === "long" ? exitRaw*(1-slip) : exitRaw*(1+slip);
    const rawRet = sig.side === "long" ? exit/entry-1 : entry/exit-1;
    const fr = funding(d.fundingBySymbol[sig.symbol]||[], entryBar.ts, exitTs);
    const fundRet = sig.side === "long" ? -fr : fr;
    const net = rawRet + fundRet - 2*fee;
    out.push({family:family.id,symbol:sig.symbol,side:sig.side,signalTs:ts,entryTs:entryBar.ts,exitTs,requestedGross:GROSS,netUnitReturn:net,exitReason:`IDLE_${reason.toUpperCase()}`,rank:3});
    blockedUntil = exitTs + BAR;
  }
  return out;
}
function metrics(rows: Trade[]) {
  let eq=1,peak=1,dd=0,gp=0,gl=0; for(const t of rows){const r=GROSS*t.netUnitReturn;eq*=Math.max(1e-9,1+r);peak=Math.max(peak,eq);dd=Math.min(dd,eq/peak-1);if(r>0)gp+=r;else gl-=r;}
  return {trades:rows.length,returnPct:(eq-1)*100,profitFactor:gl>0?gp/gl:(gp>0?999:null),winRatePct:rows.length?rows.filter(t=>t.netUnitReturn>0).length/rows.length*100:0,maxDrawdownPct:dd*100};
}
function segment(rows:Trade[], start:number,end:number){return rows.filter(t=>t.entryTs>=start&&t.entryTs<end);}
function overlapsBaseline(t:Trade, baseline:any[]){return baseline.some(x=>Number(x.entryTs)<t.exitTs&&Number(x.exitTs)>t.entryTs);}
function key(t:Trade){return `${t.symbol}|${t.side}|${t.signalTs}|${t.entryTs}|${t.exitTs}`;}

async function main(){
  const baselinePath=process.env.V12_LEDGER_IN; if(!baselinePath) throw new Error('V12_LEDGER_IN required');
  const baseline=JSON.parse(await fs.readFile(baselinePath,'utf8'));
  const baselineTrades:any[]=baseline.modes.normal.trades;
  const d=await loadPerpMarketData({symbols:ALL,startTs:WARM,endTs:END+4*H}); const p=prep(d);
  const periods=[
    {id:'DEV_2023',start:Date.UTC(2023,0,1),end:Date.UTC(2024,0,1)},
    {id:'VAL_2024',start:Date.UTC(2024,0,1),end:Date.UTC(2025,0,1)},
    {id:'PREHOLDOUT_2025',start:Date.UTC(2025,0,1),end:Date.UTC(2026,0,1)},
    {id:'HOLDOUT_2026',start:Date.UTC(2026,0,1),end:END},
  ];
  const studies:any[]=[];
  const store=new Map<string,{normal:Trade[];stress:Trade[]}>();
  for(const family of FAMILIES){
    const normal=buildTrades(d,p,family,false); const stress=buildTrades(d,p,family,true); store.set(family.id,{normal,stress});
    const splits:any={}; for(const q of periods)splits[q.id]={normal:metrics(segment(normal,q.start,q.end)),stress:metrics(segment(stress,q.start,q.end))};
    const pre=[...segment(normal,periods[0].start,periods[2].end)];
    const eligible=splits.DEV_2023.normal.returnPct>0&&splits.VAL_2024.normal.returnPct>0&&splits.PREHOLDOUT_2025.normal.returnPct>0&&splits.VAL_2024.stress.returnPct>=0&&splits.PREHOLDOUT_2025.stress.returnPct>=0&&metrics(pre).profitFactor!==null&&Number(metrics(pre).profitFactor)>=1.05&&pre.length>=30;
    const selectionScore=Math.min(splits.DEV_2023.normal.returnPct,splits.VAL_2024.normal.returnPct,splits.PREHOLDOUT_2025.normal.returnPct);
    studies.push({family:family.id,eligiblePreHoldout:eligible,selectionScore,splits,pre2026:metrics(pre)});
  }
  const preSelected=[...studies].filter(x=>x.eligiblePreHoldout).sort((a,b)=>b.selectionScore-a.selectionScore)[0]||null;
  let selected:any=null; let currentLedger:any=null;
  if(preSelected){
    const audit=preSelected.splits.HOLDOUT_2026; const holdoutPass=audit.normal.returnPct>0&&audit.stress.returnPct>=0&&Number(audit.normal.profitFactor||0)>=1.0;
    if(holdoutPass){
      selected=preSelected;
      const pair=store.get(selected.family)!; const stressMap=new Map(pair.stress.map(t=>[key(t),t]));
      const idleNormal=pair.normal.filter(t=>t.entryTs>=CURRENT_START&&!overlapsBaseline(t,baselineTrades));
      const idleStress=idleNormal.map(t=>stressMap.get(key(t))).filter((x):x is Trade=>Boolean(x));
      currentLedger={schema:'current-v12-idle-overlay/v1',strategyId:selected.family,researchOnly:true,definition:{gross:GROSS,entryOnlyWhenFrozenCurrentV12StandaloneIsIdle:true},modes:{normal:{metrics:metrics(idleNormal),trades:idleNormal},stress:{metrics:metrics(idleStress),trades:idleStress}}};
    }
  }
  const payload={status:'PASS_RESEARCH_ONLY',studyPeriod:{startInclusive:new Date(STUDY_START).toISOString(),endExclusive:new Date(END).toISOString()},selection:{rule:'select using 2023/2024/2025 only; audit 2026 after selection',preSelected:preSelected?.family||null,holdoutPromoted:selected?.family||null},families:studies,currentIdleLedger:currentLedger,safety:{mode:'RESEARCH_ONLY',ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}};
  const out=process.env.IDLE_OVERLAY_OUT||'.research-state/weak-month-b/result.json'; await fs.mkdir(path.dirname(out),{recursive:true}); await fs.writeFile(out,JSON.stringify(payload,null,2)+'\n'); console.log(JSON.stringify(payload,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
