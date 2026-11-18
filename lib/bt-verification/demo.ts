import type {Replay,ReplayFrame,BtcCandle,Position,DemoSignal} from "./replay";

/**
 * Causal synthetic-market UI sandbox, NOT a DisDex certified backtest.
 * - A 5-minute-tick path forms each 1h BTC bar progressively.
 * - All signals use the current observed tick and PREVIOUSLY COMPLETED hourly bars.
 * - Trades are triggered by price crossings; never fixed timestamps.
 * - Position marks, gross and JPY equity are recomputed on every tick.
 * - No live exchange / remote API / current pinned production strategy calls.
 */
export type DemoScenario="trend"|"range"|"down"|"volatile";
export const DEMO_HOURS=144;
export const DEMO_WARMUP_HOURS=68;
export const DEMO_TICKS_PER_HOUR=12;
export const DEMO_BASE_JPY=10_000;
export const DEMO_SYNTHETIC_USDJPY=145;
export const DEMO_FEE_RATE=0.001;
const START=Date.parse("2025-10-01T00:00:00Z");
const round=(n:number,d=2)=>Number(n.toFixed(d));
const iso=(ms:number)=>new Date(ms).toISOString().replace(".000Z","Z");
const tickTime=(tick:number)=>iso(START+tick*300_000);
function seeded(seed:number){
  let state=(seed>>>0)||123456;
  return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4_294_967_296};
}
function gaussian(rng:()=>number):number {
  const x=Math.max(1e-12,rng()),y=rng();
  return Math.sqrt(-2*Math.log(x))*Math.cos(2*Math.PI*y);
}
type Rule={logic:string;side:"LONG"|"SHORT";direction:"ABOVE"|"BELOW";gross:number;lookback:number;buffer:number;maxTicks:number};
export const DEMO_RULES:Rule[]=[
  {logic:"DEMO_V4",side:"LONG",direction:"ABOVE",gross:.48,lookback:5,buffer:.00035,maxTicks:108},
  {logic:"DEMO_PENGU",side:"SHORT",direction:"BELOW",gross:.34,lookback:6,buffer:.00035,maxTicks:120},
  {logic:"DEMO_Q102",side:"LONG",direction:"ABOVE",gross:.26,lookback:6,buffer:.00025,maxTicks:84},
];
type OpenModel={id:string;rule:Rule;entry:number;qty:number;remaining:number;entryAt:string;entryGross:number;enteredTick:number;partial:boolean};
function unrealized(p:OpenModel,mark:number){
  return p.remaining*(mark-p.entry)*(p.rule.side==="LONG"?1:-1)*DEMO_SYNTHETIC_USDJPY;
}
function signalThreshold(rule:Rule,previous:BtcCandle[]):number|null {
  if(previous.length<rule.lookback)return null;
  const look=previous.slice(-rule.lookback);
  if(rule.logic==="DEMO_Q102"){
    // Recovery across the prior 6-bar closing average. No use of current/future candle close.
    return round(look.reduce((sum,c)=>sum+c.close,0)/look.length*(1+rule.buffer));
  }
  return round(rule.direction==="ABOVE"?
    Math.max(...look.map(c=>c.high))*(1+rule.buffer):
    Math.min(...look.map(c=>c.low))*(1-rule.buffer));
}
function marketDrift(scenario:DemoScenario,tick:number,price:number):number {
  const wave=Math.sin(tick/105)*.0001+Math.sin(tick/391)*.000065;
  if(scenario==="trend")return .000077+wave;
  if(scenario==="down")return -.000074+wave;
  if(scenario==="range")return -.0045*Math.log(price/108300)+wave*.42;
  return .000014+wave*.9;
}
function marketSigma(scenario:DemoScenario,shock:number,previous:number):number {
  const base=scenario==="volatile"?.00205:scenario==="range"?.00115:.00136;
  // Volatility clusters around shocks, as it often does in financial markets.
  return Math.max(base*.55,Math.min(base*3,previous*.88+base*.12+Math.abs(shock)*base*.048));
}
export function createPreviewReplay(seed=123456,scenario:DemoScenario="trend"):Replay {
  const rng=seeded(seed);
  const closed:BtcCandle[]=[];
  const frames:ReplayFrame[]=[];
  const active=new Map<string,OpenModel>();
  const cooldown=new Map<string,number>();
  let price=108_300,vol=scenario==="volatile"?.00205:.00136;
  let realized=0,sequence=0;
  function advanceObservedMarketTick(marketTick:number){
    const shock=Math.max(-3.6,Math.min(3.6,gaussian(rng)));
    vol=marketSigma(scenario,shock,vol);
    const jump=rng()<.004?(rng()<.5?-1:1)*(.004+(.003*rng())):0;
    const logMove=marketDrift(scenario,marketTick,price)+vol*shock+jump;
    price=round(Math.max(70_000,Math.min(180_000,price*Math.exp(logMove))));
  }
  // Completed warmup candles are strictly BEFORE the replay start. They provide
  // a realistic rolling chart and historical thresholds from the first replay tick.
  // No warmup trades, fills or changes to the account's opening equity are allowed.
  for(let h=-DEMO_WARMUP_HOURS;h<0;h++){
    const start=START+h*3_600_000;
    const open=price;let high=price,low=price;
    for(let j=0;j<DEMO_TICKS_PER_HOUR;j++){
      const marketTick=(h+DEMO_WARMUP_HOURS)*DEMO_TICKS_PER_HOUR+j+1;
      advanceObservedMarketTick(marketTick);
      high=Math.max(high,price);low=Math.min(low,price);
    }
    closed.push({time:iso(start),closedAt:iso(start+3_600_000),
      open:round(open),high:round(high),low:round(low),close:price});
  }
  for(let hour=0;hour<DEMO_HOURS;hour++){
    let candleOpen=price,candleHigh=price,candleLow=price;
    const hourStart=START+hour*3_600_000;
    for(let inBar=0;inBar<DEMO_TICKS_PER_HOUR;inBar++){
      const tick=hour*DEMO_TICKS_PER_HOUR+inBar+1;
      const at=tickTime(tick);
      const previous=price;
      advanceObservedMarketTick(DEMO_WARMUP_HOURS*DEMO_TICKS_PER_HOUR+tick);
      candleHigh=Math.max(candleHigh,price);
      candleLow=Math.min(candleLow,price);
      const events:string[]=[];
      // Exit / partial logic is evaluated before new entries on each new observed tick.
      for(const [logic,p] of [...active]){
        const tradeReturn=(price/p.entry-1)*(p.rule.side==="LONG"?1:-1);
        const age=tick-p.enteredTick;
        const reason=tradeReturn>=.018?"DEMO_TP_1.8%":tradeReturn<=-.011?"DEMO_STOP_-1.1%":age>=p.rule.maxTicks?"DEMO_TIME_EXIT":null;
        if(reason!==null){
          const pnl=unrealized(p,price)-p.remaining*price*DEMO_SYNTHETIC_USDJPY*DEMO_FEE_RATE;
          realized+=pnl;
          events.push("EXIT "+logic+" BTC "+p.rule.side+" reason="+reason+" "+round(pnl).toFixed(2).replace(/^([^-])/,"+$1")+" JPY [DEMO_CROSSING]");
          active.delete(logic);
          cooldown.set(logic,tick+DEMO_TICKS_PER_HOUR*2);
          continue;
        }
        // A true price-driven partial: no guaranteed fixed-time partial close.
        if(!p.partial&&tradeReturn>=.009){
          const half=p.remaining*.5;
          const pnl=half*(price-p.entry)*(p.rule.side==="LONG"?1:-1)*DEMO_SYNTHETIC_USDJPY-
            half*price*DEMO_SYNTHETIC_USDJPY*DEMO_FEE_RATE;
          realized+=pnl;p.remaining-=half;p.partial=true;
          events.push("PARTIAL "+logic+" BTC "+p.rule.side+" reason=DEMO_PROFIT_0.9% "+round(pnl).toFixed(2).replace(/^([^-])/,"+$1")+" JPY [DEMO_CROSSING]");
        }
      }
      let equity=DEMO_BASE_JPY+realized+[...active.values()].reduce((n,p)=>n+unrealized(p,price),0);
      const demoSignals:DemoSignal[]=[];
      for(const rule of DEMO_RULES){
        const threshold=signalThreshold(rule,closed); // closed contains only bars completed before THIS tick
        const crossed=threshold!==null&&(rule.direction==="ABOVE"?(previous<=threshold&&price>threshold):(previous>=threshold&&price<threshold));
        const positionOpen=active.has(rule.logic);
        const waiting=tick<(cooldown.get(rule.logic)??0);
        const fired=crossed&&!positionOpen&&!waiting;
        const note=threshold===null?"確定足の蓄積中":!crossed?"価格の閾値突破なし":positionOpen?"同ロジック保有中":waiting?"再発火クールダウン中":"価格が閾値を突破 → 模擬発火";
        demoSignals.push({logic:rule.logic,side:rule.side,direction:rule.direction,price,threshold,crossed,fired,note});
        if(fired){
          const notional=equity*rule.gross;
          const qty=notional/(price*DEMO_SYNTHETIC_USDJPY);
          realized-=notional*DEMO_FEE_RATE; // entry fee
          const p:OpenModel={id:rule.logic+"-"+(++sequence),rule,entry:price,qty,remaining:qty,
            entryAt:at,entryGross:rule.gross,enteredTick:tick,partial:false};
          active.set(rule.logic,p);
          events.push("ENTRY "+rule.logic+" BTC "+rule.side+
            " price="+price.toFixed(2)+" crossing="+threshold?.toFixed(2)+" [DEMO_CROSSING]");
          equity=DEMO_BASE_JPY+realized+[...active.values()].reduce((n,o)=>n+unrealized(o,price),0);
        }
      }
      equity=DEMO_BASE_JPY+realized+[...active.values()].reduce((n,p)=>n+unrealized(p,price),0);
      const positions:Position[]=[...active.values()].map(p=>{
        const gross=p.remaining*price*DEMO_SYNTHETIC_USDJPY/Math.max(1,equity);
        return {id:p.id,logic:p.rule.logic,symbol:"BTC",side:p.rule.side,quantity:round(p.remaining,10),
          entry:p.entry,mark:price,gross:round(gross,6),grossAtEntry:p.entryGross,openedAt:p.entryAt,
          ...(p.partial?{lastPartialGrossX:round(gross,6),lastPartialFractionClosed:.5}:{}),
        };
      });
      const bar:BtcCandle={time:iso(hourStart),closedAt:iso(hourStart+3_600_000),
        open:round(candleOpen),high:round(candleHigh),low:round(candleLow),close:price};
      const closing=inBar===DEMO_TICKS_PER_HOUR-1;
      // Do not include an in-progress bar in the completed candlestick ledger.
      // The current bar's OHLC is a snapshot of ticks observed so far.
      frames.push({timestamp:at,btc:price,equity:round(equity),realized:round(realized),
        positions,events,demoSignals,...(!closing?{formingBtcCandle:bar}:{})});
      if(closing)closed.push(bar);
    }
  }
  return {schema:"disdex-bt-portfolio-v1",mode:"DEMO",
    engineSha:"VISUAL_DEMO_SYNTHETIC_NOT_A_BACKTEST",seed,
    limits:{total:3.5,crypto:3,stock:1.5},frames,btcCandles:closed,
    source:{kind:"SYNTHETIC_CAUSAL_PRICE_TICKS_UI_ONLY",grossCapEvidence:"USER_SUPPLIED_NOT_VERIFIED",
      note:"All 5-minute ticks, 68 hours of pre-replay chart warmup, hourly OHLC, 3 proxy signal gates, fills, fees, positions, Gross and JPY equity are synthetic. Decisions use only past completed candles and current observed price. These are NOT genuine V4/PENGU/Q102 runtime rules or venue fills."}};
}
