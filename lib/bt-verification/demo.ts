import type { Replay, ReplayFrame, BtcCandle, Position } from "./replay";

/**
 * Visual UI demonstration: mathematically synthetic BTC candles and model positions.
 * Never represent this as a strategy backtest, authenticated venue fill or current market data.
 */
export type DemoScenario = "trend" | "range" | "down" | "volatile";
const START=Date.parse("2025-10-01T00:00:00Z");
const candleIso=(hour:number)=>new Date(START+hour*3600000).toISOString().replace(".000Z","Z");
function seeded(seed:number){let state=(seed>>>0)||123456;return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296}}
export function createPreviewReplay(seed=123456,scenario:DemoScenario="trend"):Replay {
  const rng=seeded(seed);
  const candles:BtcCandle[]=[];
  let previous=108300;
  for(let i=0;i<288;i++){
    const drift=scenario==="trend"?33:scenario==="range"?Math.sin(i/15)*20:scenario==="down"?-23:Math.sin(i/11)*85;
    const change=drift+Math.sin(i/6)*64+(rng()-.5)*200;
    const close=Math.max(54000,previous+change),wiggle=85+rng()*160;
    candles.push({time:candleIso(i),closedAt:candleIso(i+1),open:Number(previous.toFixed(2)),close:Number(close.toFixed(2)),
      high:Number((Math.max(previous,close)+wiggle).toFixed(2)),low:Number((Math.min(previous,close)-wiggle*.86).toFixed(2))});
    previous=close;
  }
  const plans=[
    {id:"demo-v4-btc",logic:"V4",symbol:"BTC",side:"LONG" as const,start:5,end:23,qty:.03,entry:109300,gross:.48},
    {id:"demo-pengu",logic:"PENGU",symbol:"PENGU",side:"SHORT" as const,start:10,end:32,qty:120,entry:.034,gross:.36},
    {id:"demo-q102",logic:"Q102",symbol:"AVAX",side:"LONG" as const,start:18,end:41,qty:9,entry:33,gross:.30},
    {id:"demo-v52",logic:"V52",symbol:"AMZN",side:"LONG" as const,start:30,end:52,qty:3,entry:189,gross:.21},
    {id:"demo-fet",logic:"FET",symbol:"FET",side:"LONG" as const,start:39,end:66,qty:45,entry:1.12,gross:.28},
    {id:"demo-hype",logic:"HYPE",symbol:"HYPE",side:"SHORT" as const,start:56,end:70,qty:2,entry:25,gross:.18},
  ];
  const frames:ReplayFrame[]=[];
  for(let i=0;i<72;i++){
    const at=candleIso(i*4);
    const btc=i===0?null:candles[i*4-1].close;
    const positions:Position[]=plans.filter(p=>i>=p.start&&i<p.end).map(p=>{
      const elapsed=i-p.start;
      const mark=p.symbol==="BTC"?(btc??p.entry):
       Number((p.entry*(1+Math.sin(elapsed/5)*.012+elapsed*(p.side==="LONG"?.001:-.0005))).toFixed(p.entry<1?5:2));
      const partial=p.id==="demo-pengu"&&i>=25;
      return {id:p.id,logic:p.logic,symbol:p.symbol,side:p.side,quantity:partial?p.qty*.5:p.qty,
        entry:p.entry,mark,gross:partial?p.gross*.5:p.gross,grossAtEntry:p.gross,
        openedAt:candleIso(p.start*4),
        ...(partial?{lastPartialGrossX:p.gross*.5,lastPartialAt:candleIso(25*4),lastPartialFractionClosed:.5}:{}),
      };
    });
    const events:string[]=[];
    for(const p of plans){
      if(i===p.start)events.push("ENTRY "+p.logic+" "+p.symbol+" "+p.side+" [+DEMO]");
      if(i===p.end)events.push("EXIT "+p.logic+" "+p.symbol+" reason=DEMO_TP +145.00 JPY [DEMO]");
    }
    if(i===25)events.push("PARTIAL PENGU PENGU SHORT closed=50% remaining=0.18x [DEMO]");
    const direction=scenario==="down"?-1.05:scenario==="range"?.23:scenario==="volatile"?.48:1;
    const equity=Math.max(3500,10000+direction*i*33+Math.sin(i/4)*145+Math.sin(i*1.4)*36);
    const realized=Math.max(-900,Math.round(direction*i*19));
    frames.push({timestamp:at,btc,equity:Number(equity.toFixed(2)),realized,positions,events});
  }
  return {schema:"disdex-bt-portfolio-v1",mode:"DEMO",engineSha:"VISUAL_DEMO_SYNTHETIC_NOT_A_BACKTEST",
    seed,limits:{total:3.5,crypto:3,stock:1.5},frames,btcCandles:candles,
    source:{kind:"SYNTHETIC_UI_ONLY",grossCapEvidence:"USER_SUPPLIED_NOT_VERIFIED",
      note:"Entirely artificial candles, fills, equity and positions for UI demonstration. No true BT calculation."}};
}
