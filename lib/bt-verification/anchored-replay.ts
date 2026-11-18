import {createAnchoredMarket,type AnchoredSymbol} from "./anchored-market";
import {contributionEvents} from "./capital-accounting";
import type {BtcCandle,Replay,ReplayFrame} from "./replay";

export type AnchoredReplayConfig={
 startDate:string;endDate:string;seed:number;initialJpy:number;
 symbols:AnchoredSymbol[];anchorUtcDate:string;costBps:10|30;
 interest:"SIMPLE"|"COMPOUND";contribution?:{amountJpy:number;frequency:"MONTHLY"|"WEEKLY";day:number};
};
export function createAnchoredChartReplay(config:AnchoredReplayConfig):Replay{
 if(!Number.isFinite(config.initialJpy)||config.initialJpy<=0)throw new Error("INVALID_INITIAL_JPY");
 if(!config.symbols.some(v=>v.symbol==="BTCUSDT"))throw new Error("BTC_OVERVIEW_REQUIRED");
 const prices=createAnchoredMarket({
  startDate:config.startDate,endDate:config.endDate,seed:config.seed,symbols:config.symbols
 });
 const makeCandle=(bar:{time:string;open:number;high:number;low:number;close:number}):BtcCandle=>{
  const day=Date.parse(bar.time+"T00:00:00Z");
  return {...bar,time:new Date(day).toISOString().replace(".000Z","Z"),
   closedAt:new Date(day+86400000).toISOString().replace(".000Z","Z")};
 };
 const symbolCandles=Object.fromEntries(Object.entries(prices).map(([symbol,bars])=>
  [symbol,bars.map(makeCandle)]));
 const deposits=config.contribution
  ?contributionEvents(config.startDate,config.endDate,
   config.contribution.amountJpy,config.contribution.frequency,config.contribution.day):[];
 const byDate=new Map<string,number>();
 for(const entry of deposits)byDate.set(entry.date,(byDate.get(entry.date)??0)+entry.amountJpy);
 const btc=prices.BTCUSDT;
 let netDeposits=0;
 const firstTs=config.startDate+"T00:00:00Z";
 const frames:ReplayFrame[]=[{timestamp:firstTs,btc:btc[0].open,equity:config.initialJpy,
  realized:0,netDepositsJpy:0,tradingPnlJpy:0,positions:[],events:["模擬価格のみ。Productionロジック未接続・発注なし。"]}];
 for(const bar of btc){
  const deposited=byDate.get(bar.time)??0;
  netDeposits+=deposited;
  const ts=new Date(Date.parse(bar.time+"T00:00:00Z")+86400000).toISOString().replace(".000Z","Z");
  frames.push({timestamp:ts,btc:bar.close,equity:config.initialJpy+netDeposits,
   realized:0,netDepositsJpy:netDeposits,tradingPnlJpy:0,positions:[],events:deposited>0?["EXTERNAL DEPOSIT "+deposited+" JPY (取引損益ではない)"]:[]});
 }
 return {
  schema:"disdex-bt-portfolio-v1",mode:"DEMO",
  engineSha:"SYNTHETIC_PRICES_ONLY_NO_PRODUCTION_STRATEGY",
  seed:config.seed,frames,btcCandles:symbolCandles.BTCUSDT,
  symbolCandles,limits:{total:3.5,crypto:3.0,stock:1.5},
  source:{kind:"SYNTHETIC_ANCHORED_DAILY_NO_STRATEGY",
    note:JSON.stringify({market:"synthetic",anchorVenue:"Aster Futures public klines",
      anchorUtcDate:config.anchorUtcDate,
      anchors:Object.fromEntries(config.symbols.map(v=>[v.symbol,v.anchorClose])),
      startDate:config.startDate,endDate:config.endDate,costBps:config.costBps,
      initialJpy:config.initialJpy,interest:config.interest,contribution:config.contribution??null,
      disclaimer:"No actual strategy fills, no production parity, no intraday candles"})}
 };
}