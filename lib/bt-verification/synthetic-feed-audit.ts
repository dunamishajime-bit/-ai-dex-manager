import {SyntheticMarket5m,type SyntheticFeedVersion,type SyntheticScenario,SYNTHETIC_DATA_REQUIREMENTS} from "./synthetic-market";

export type SyntheticFeedAudit={
 schema:"disdex-bt-input-audit-v1";
 seed:number;scenario:SyntheticScenario;feedVersion:SyntheticFeedVersion;generatedAtWindowEnd:string;
 firstObservedAt:string;lastObservedAt:string;hours:number;ticks:number;
 cryptoSymbols:number;stockSymbols:number;totalSymbols:number;
 btcClosedH1:number;hypeClosedH1:number;fundingEvents:number;
 stockSessionObservations:number;partialSessionBars:number;
 btcMin:number;btcMax:number;hypeMin:number;hypeMax:number;lastUsdJpy:number;
 nativeRunnerDecisionReady:false;
 blockers:readonly string[];
};
export function auditSyntheticFeed(
 seed:number,scenario:SyntheticScenario,hours=168,feedVersion:SyntheticFeedVersion="v1"
):SyntheticFeedAudit{
  if(!Number.isSafeInteger(hours)||hours<1||hours>24*7)throw Error("SYNTHETIC_UI_AUDIT_WINDOW_INVALID");
  const start="2025-10-01T00:00:00Z";
  const end=new Date(Date.parse(start)+hours*3_600_000).toISOString().replace(".000Z","Z");
  const feed=new SyntheticMarket5m(seed,scenario,{start,endExclusive:end,version:feedVersion});
  let ticks=0,first="",last="",btcH1=0,hypeH1=0,funding=0,stockSession=0,partial=0;
  let btcMin=Infinity,btcMax=-Infinity,hypeMin=Infinity,hypeMax=-Infinity,usdJpy=0;
  feed.runToEnd(step=>{
    ticks++;if(!first)first=step.observedAt;last=step.observedAt;usdJpy=step.usdJpy;
    const btc=step.quotes.find(x=>x.symbol==="BTCUSDT")?.price;
    const hype=step.quotes.find(x=>x.symbol==="HYPEUSDT")?.price;
    if(!btc||!hype)throw Error("SYNTHETIC_FEED_BTC_OR_HYPE_MISSING");
    btcMin=Math.min(btcMin,btc);btcMax=Math.max(btcMax,btc);
    hypeMin=Math.min(hypeMin,hype);hypeMax=Math.max(hypeMax,hype);
    btcH1+=step.completedH1.filter(x=>x.symbol==="BTCUSDT").length;
    hypeH1+=step.completedH1.filter(x=>x.symbol==="HYPEUSDT").length;
    funding+=step.funding.length;
    stockSession+=step.quotes.filter(x=>x.category==="stock"&&x.tradable).length;
    partial+=step.completedH1.filter(x=>x.category==="stock"&&x.partialSession).length;
  });
  if(ticks!==hours*12||btcH1!==hours||hypeH1!==hours||!Number.isFinite(usdJpy))
    throw Error("SYNTHETIC_FEED_AUDIT_INCOMPLETE");
  return {schema:"disdex-bt-input-audit-v1",seed,scenario,feedVersion,generatedAtWindowEnd:end,
    firstObservedAt:first,lastObservedAt:last,hours,ticks,
    cryptoSymbols:feed.description.symbols.filter(s=>s.endsWith("USDT")).length,
    stockSymbols:feed.description.symbols.filter(s=>!s.endsWith("USDT")).length,
    totalSymbols:feed.description.symbols.length,
    btcClosedH1:btcH1,hypeClosedH1:hypeH1,fundingEvents:funding,
    stockSessionObservations:stockSession,partialSessionBars:partial,
    btcMin,btcMax,hypeMin,hypeMax,lastUsdJpy:usdJpy,nativeRunnerDecisionReady:false,
    blockers:[
      "V4/Q102/PENGU/V52: 元シグナルが未接続。FET/IDLEは入口関数のShadow点検のみで、Runner約定・出口・枠管理は未接続",
      "HYPE: 既存のH48単体研究モードは別実装。現行LIVEとの全出口・優先順位一致は未認証",
      "Q102 Online: 学習済み状態と各時点で利用可能だった過去学習行の注入が未完了",
      "Portfolio Layer3・Shared Risk・Gross: 複数Runnerの建玉・機会競合をまだ一括計算していない",
      "株式: 米国市場の休日・臨時休場・株式分割は人工データの簡易カレンダーに未反映",
      "Funding・FX・出来高: 生成値は架空。取引所記録や実市場証拠ではない",
      ...SYNTHETIC_DATA_REQUIREMENTS.nativeEnginesConnected
    ]};
}
