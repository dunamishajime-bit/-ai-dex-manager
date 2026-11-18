import type {Replay} from "./replay";
import {portfolioMetrics} from "./portfolio-metrics";

function researchScenario(replay:Replay){
 const note=replay.source?.note??"";
 const match=note.match(/\|\s*(IDLE|FET|HYPE)\s*\|\s*(10|30)bps\s*\|/);
 return match?{strategy:match[1],cost:Number(match[2])}:null;
}
function anchoredSignature(replay:Replay){
 try{
  const parsed=JSON.parse(replay.source?.note??"") as Record<string,unknown>;
  if(parsed.market!=="synthetic")return null;
  return JSON.stringify({
   seed:replay.seed,start:parsed.startDate,end:parsed.endDate,
   day:parsed.anchorUtcDate,anchors:parsed.anchors
  });
 }catch{return null;}
}
export function compareReplayPair(a:Replay,b:Replay){
 if(a.source?.kind!==b.source?.kind)return {comparable:false,reason:"市場データ種別が異なります。",stats:null};
 const kind=a.source?.kind;
 if(kind==="SYNTHETIC_ANCHORED_DAILY_NO_STRATEGY"){
  if(anchoredSignature(a)===null||anchoredSignature(a)!==anchoredSignature(b))
   return {comparable:false,reason:"アンカー価格・期間・シード・通貨が一致しません。",stats:null};
  return {comparable:false,reason:"同一人工市場ですが、Productionロジック未接続のため運用成績を比較できません。",stats:null};
 }
 if(kind!=="HISTORICAL_STANDALONE_MODEL_NOT_INTEGRATED"){
  return {comparable:false,reason:"比較対象として証跡が認められていないデータです。",stats:null};
 }
 const xa=researchScenario(a),xb=researchScenario(b);
 if(!xa||!xb||xa.strategy!==xb.strategy||
    !a.source?.btcCandlesSha256||a.source.btcCandlesSha256!==b.source?.btcCandlesSha256||
    !a.source?.equitySha256||a.source.equitySha256!==b.source?.equitySha256||
    !a.source?.fillsSha256||a.source.fillsSha256!==b.source?.fillsSha256){
  return {comparable:false,reason:"同一ロジックと同一市場・約定台帳の証跡が確認できません。",stats:null};
 }
 if(a.frames[0].timestamp!==b.frames[0].timestamp||
    a.frames.at(-1)?.timestamp!==b.frames.at(-1)?.timestamp){
  return {comparable:false,reason:"比較期間が異なります。",stats:null};
 }
 const ma=portfolioMetrics(a.frames,a.frames.length-1),mb=portfolioMetrics(b.frames,b.frames.length-1);
 return {comparable:true,
   reason:"同じ単独研究モデル・基準データにおけるコスト別比較です。8系統統合BTではありません。",
   stats:{strategy:xa.strategy,costA:xa.cost,costB:xb.cost,
    capitalA:ma.current,capitalB:mb.current,
    pnlA:ma.tradingProfit,pnlB:mb.tradingProfit,
    maxDdA:ma.maxDD,maxDdB:mb.maxDD,
    pnlDifference:mb.tradingProfit-ma.tradingProfit}};
}