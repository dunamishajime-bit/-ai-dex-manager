/** Reference-only V12 V4 bonus for the common Aster market ranking.
 * Only authenticated, source-fingerprint-matched Runner telemetry may enter here.
 * The score never feeds an order, Gross, Gate, risk policy or sizing.
 */
import type { RankRow, Gate } from "./realtime-ranking";

export const V4_GATE_BONUS_PER_PASS=3;
export const V4_GATE_MAX_BONUS=15;
export const V4_SCORE_BONUS_SOURCE_KEYS=[
  "VOLUME_RATIO","EDGE_TO_COST","DIRECTIONAL_MOMENTUM","REGIME_ENTRY_QUALITY",
] as const;
export type V4SourceGateState="PASS"|"BLOCK"|"NOT_EVALUATED";
export type V4GateTelemetryItem={
 symbol:string;nativeSide:"LONG"|"SHORT"|null;sourceEligible:boolean|null;sourceReason:string;
 portfolioRank:number|null;nativeScore:number|null;
 gates:Array<{key:string;state:V4SourceGateState;actual:number|string|null;required:number|string;reason:string}>;
 routeGate:{state:V4SourceGateState;routes:string[];reason:string};
};
export type V4VerifiedGateTelemetry={
 releaseSha:string;decisionTs:number;capturedAtMs:number;sourceFingerprint:string;
 symbols:V4GateTelemetryItem[];verified:true;
};
export type V4ScoreParts={marketBaseScore:number;v4GateBonus:number;v4SourceGatePassCount:number;
 v4RouteEmitted:boolean;v4GateDecisionTs:number};

function formatNum(n:number){return Math.round(n*100)/100;}
function scoreParts(item:V4GateTelemetryItem,base:number,ts:number):V4ScoreParts{
 const seen=new Map(item.gates.map(g=>[g.key,g]));
 const sourcePass=V4_SCORE_BONUS_SOURCE_KEYS.filter(key=>seen.get(key)?.state==="PASS").length;
 const routePass=item.routeGate.state==="PASS";
 const bonus=Math.min(V4_GATE_MAX_BONUS,V4_GATE_BONUS_PER_PASS*(sourcePass+(routePass?1:0)));
 return {marketBaseScore:base,v4GateBonus:bonus,v4SourceGatePassCount:sourcePass,
  v4RouteEmitted:routePass,v4GateDecisionTs:ts};
}
export function applyV4GateBonusToMarketRows(
 rows:RankRow[], data:V4VerifiedGateTelemetry|null,
):RankRow[]{
 if(!data)return rows;
 const known=new Map(data.symbols.map(item=>[item.symbol,item]));
 return rows.map(row=>{
  const evidence=row.logic==="MARKET"&&row.fresh&&row.scoreKind==="MARKET"&&
   typeof row.score==="number"&&Number.isFinite(row.score)?known.get(row.symbol):undefined;
  if(!evidence)return row;
  const parts=scoreParts(evidence,row.score!,data.decisionTs);
  const extraGateRows:Gate[]=[
   ...evidence.gates.map(g=>({
    key:"v4-"+g.key,label:"V12 V4実Runner "+g.key,
    state:g.state==="PASS"?"OK" as const:g.state==="BLOCK"?"NO" as const:"UNKNOWN" as const,
    actual:g.actual===null?undefined:g.actual,required:g.required,
    detail:g.reason+" / V4確定足 "+new Date(data.decisionTs).toISOString(),
    kind:"signal" as const,
   })),
   {key:"v4-route-emitted",label:"V12 V4 route候補出力",
    state:evidence.routeGate.state==="PASS"?"OK" as const:evidence.routeGate.state==="BLOCK"?"NO" as const:"UNKNOWN" as const,
    detail:evidence.routeGate.reason+" / "+evidence.routeGate.routes.join(","),kind:"signal" as const},
  ];
  const score=formatNum(Math.min(100,row.score!+parts.v4GateBonus));
  return {...row,score,scoreKind:"MARKET_PLUS_V4" as const,
   scoreLabel:"共通市場Score "+parts.marketBaseScore.toFixed(2)+" + V12 V4実Runner Gate参考加点 "+
    parts.v4GateBonus.toFixed(2)+"（最大15・発注非連動）",
   v4Reference:parts,gates:[...row.gates,...extraGateRows],
   reason:row.reason+" / V4 source Gate "+parts.v4SourceGatePassCount+"/4、Route出力 "+
     (parts.v4RouteEmitted?"あり":"なし・未評価")+" / 参考加点 +"+parts.v4GateBonus,
  };
 });
}
