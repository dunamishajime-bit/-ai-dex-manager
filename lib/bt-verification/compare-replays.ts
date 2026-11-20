import type {Replay} from "./replay";
import {portfolioMetrics} from "./portfolio-metrics";

function standaloneScenario(replay:Replay){
 const match=(replay.source?.note??"").match(/\|\s*(IDLE|FET|HYPE)\s*\|\s*(10|30)bps\s*\|/);
 return match?{strategy:match[1],cost:Number(match[2])}:null;
}
function stable4Scenario(replay:Replay){
 try{
  const meta:unknown=JSON.parse(replay.source?.note??"");
  if(!meta||typeof meta!=="object")return null;
  const data=meta as Record<string,unknown>;
  const expectedCase="EFFECTIVE_CURRENT_CANONICAL_CAUSAL_THREE_PRETARGET_STABLE3_Q102_ADOPTED_ON";
  const expectedStatus="CAUSAL_THREE_PLUS_PRETARGET_STABLE_ROUTE_QUARANTINE_RESEARCH_ONLY";
  if(data.case!==expectedCase||data.sourceStatus!==expectedStatus||
     data.dataInterval!=="2025-10-01..2026-10-01 UTC"||
     (data.costBps!==10&&data.costBps!==30))return null;
  if(data.costBps!==replay.researchSummary?.costBps)return null;
  return {strategy:"STABLE4",cost:Number(data.costBps),study:expectedCase};
 }catch{return null;}
}
function anchoredSignature(replay:Replay){
 try{
  const parsed=JSON.parse(replay.source?.note??"") as Record<string,unknown>;
  if(parsed.market!=="synthetic")return null;
  return JSON.stringify({seed:replay.seed,start:parsed.startDate,end:parsed.endDate,
    day:parsed.anchorUtcDate,anchors:parsed.anchors});
 }catch{return null;}
}
export function compareReplayPair(a:Replay,b:Replay){
 if(a.source?.kind!==b.source?.kind)
  return {comparable:false,reason:"市場データ種別が異なります。",stats:null};
 const kind=a.source?.kind;
 if(kind==="SYNTHETIC_ANCHORED_DAILY_NO_STRATEGY"){
  if(anchoredSignature(a)===null||anchoredSignature(a)!==anchoredSignature(b))
   return {comparable:false,reason:"アンカー価格・期間・シード・通貨が一致しません。",stats:null};
  return {comparable:false,reason:"同一人工市場ですが、Productionロジック未接続のため運用成績を比較できません。",stats:null};
 }
 const stable4=kind==="HISTORICAL_STABLE4_RESEARCH_NOT_PRODUCTION";
 const standalone=kind==="HISTORICAL_STANDALONE_MODEL_NOT_INTEGRATED";
 if(!stable4&&!standalone)
  return {comparable:false,reason:"比較対象として証跡が認められていないデータです。",stats:null};
 const xa=stable4?stable4Scenario(a):standaloneScenario(a);
 const xb=stable4?stable4Scenario(b):standaloneScenario(b);
 if(!xa||!xb||xa.strategy!==xb.strategy||xa.cost===xb.cost||
    !a.source?.btcCandlesSha256||a.source.btcCandlesSha256!==b.source?.btcCandlesSha256||
    !a.source?.equitySha256||!b.source?.equitySha256||
    !a.source?.fillsSha256||!b.source?.fillsSha256){
  return {comparable:false,reason:"同じ研究モデル・市場・コスト別の元データが確認できません。",stats:null};
 }
 if(standalone&&(a.source?.equitySha256!==b.source?.equitySha256||
    a.source?.fillsSha256!==b.source?.fillsSha256))
  return {comparable:false,reason:"単独モデルの約定台帳証跡が一致しません。",stats:null};
 if(stable4&&(
    a.engineSha!=="STABLE4_RESEARCH_SOURCE_ONLY_NOT_PRODUCTION_CERTIFIED"||
    b.engineSha!==a.engineSha||
    !a.source?.summarySha256||!b.source?.summarySha256))
  return {comparable:false,reason:"STABLE4研究のソース証跡が不足しています。",stats:null};
 if(!a.frames.length||!b.frames.length||
    a.frames[0].timestamp!==b.frames[0].timestamp||
    a.frames.at(-1)?.timestamp!==b.frames.at(-1)?.timestamp)
  return {comparable:false,reason:"比較期間が異なります。",stats:null};
 const ma=portfolioMetrics(a.frames,a.frames.length-1);
 const mb=portfolioMetrics(b.frames,b.frames.length-1);
 return {
  comparable:true,
  reason:stable4
   ?"同一STABLE4統合研究モデルの10/30bps比較です。現行LIVEの完全一致・実約定ではありません。"
   :"同じ単独研究モデル・基準データにおけるコスト別比較です。8系統統合BTではありません。",
  stats:{strategy:xa.strategy,costA:xa.cost,costB:xb.cost,
    capitalA:ma.current,capitalB:mb.current,pnlA:ma.tradingProfit,pnlB:mb.tradingProfit,
    maxDdA:ma.maxDD,maxDdB:mb.maxDD,pnlDifference:mb.tradingProfit-ma.tradingProfit}
 };
}