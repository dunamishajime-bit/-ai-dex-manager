/** Historical BT admission prerequisite: exercise actual pinned VPS governor, NOT a replacement BT. */
import fs from "node:fs";
import crypto from "node:crypto";
import { resolveIntegratedGrossGovernor } from "../../lib/disdex-integrated-gross-governor";
import { quality102GovernorGross } from "../../lib/disdex-portfolio-dd-governor";
import { INTEGRATED_PRODUCTION_RISK_POLICY as P } from "../../config/integratedProductionRiskPolicy";
const NOW=Date.UTC(2026,7,9,0);
const risk=(profitPct:number,sourceComplete=true)=>({sourceComplete,referenceEquity:1000,netDailyPnl:1000*profitPct/100} as any);
const dd=(twrIndex:number,currentDrawdownPct:number,fresh=true)=>({
  schema:"disdex-portfolio-dd-governor/v1",updatedAt:NOW-(fresh?0:300000),twrIndex,
  twrPeak:twrIndex/(1-currentDrawdownPct/100),currentDrawdownPct
} as any);
function assert(condition:boolean,why:string){if(!condition)throw Error(why)}
const rows=[
  {name:"BASE_WITHOUT_PROFIT",profit:0,twr:1.4,drawdown:0,avail:1000,existing:0,tier:"BASE",crypto:3,total:4.25},
  {name:"BASE_STALE_DD",profit:10,twr:1.4,drawdown:0,avail:1000,existing:0,stale:true,tier:"BASE",crypto:3,total:4.25},
  {name:"PROFIT_1",profit:1,twr:1.05,drawdown:3,avail:1000,existing:0,tier:"PROFIT_1",crypto:3.25,total:5},
  {name:"PROFIT_2",profit:1,twr:1.10,drawdown:2,avail:1000,existing:0,tier:"PROFIT_2",crypto:3.5,total:5},
  {name:"PROFIT_3",profit:1,twr:1.20,drawdown:1,avail:1000,existing:0,tier:"PROFIT_3",crypto:4,total:5},
  {name:"PROFIT_4",profit:1,twr:1.30,drawdown:.5,avail:1000,existing:0,tier:"PROFIT_4",crypto:5,total:5},
  {name:"PROFIT_4_MARGIN_LIMITED",profit:1,twr:1.30,drawdown:.5,avail:200,existing:2,tier:"PROFIT_4",crypto:3,total:3},
  {name:"BASE_MARGIN_RESERVE",profit:0,twr:1.3,drawdown:0,avail:500,existing:2,tier:"BASE",crypto:3,total:3.75}
];
const decisions=[];
for(const row of rows){
  const result=resolveIntegratedGrossGovernor({now:NOW,equityUsd:1000,
    availableBalanceUsd:row.avail,currentCryptoGross:0,currentTotalGross:row.existing,
    sharedDailyRisk:risk(row.profit),portfolioDdGovernor:dd(row.twr,row.drawdown,!row.stale)});
  assert(result.tier===row.tier,row.name+" tier "+result.tier);
  assert(Math.abs(result.cryptoEntryCap-row.crypto)<1e-9,row.name+" crypto "+result.cryptoEntryCap);
  assert(Math.abs(result.totalEntryCap-row.total)<1e-9,row.name+" total "+result.totalEntryCap);
  decisions.push({name:row.name,tier:result.tier,
    cryptoEntryCap:result.cryptoEntryCap,totalEntryCap:result.totalEntryCap,
    reservePct:result.availableBalanceReservePct,
    marginDerivedTotalCap:result.marginDerivedTotalCap});
}
assert(P.cryptoGrossHardCap===5&&P.totalGrossHardCap===8,"PINNED_HARD_CAP_DRIFT");
assert(P.v12MaximumPositions===3&&P.fetResidualMaximumGross===2.25,"PINNED_STRATEGY_DRIFT");
const g1=quality102GovernorGross(1.661,dd(1.2,.3),NOW);
const g2=quality102GovernorGross(1.661,dd(1.2,.31),NOW);
const g3=quality102GovernorGross(1.661,dd(1.2,.1,false),NOW);
assert(g1.gross===3&&g1.boosted&&g2.gross===1.661&&!g2.boosted&&g3.gross===1.661&&!g3.boosted,"Q102_DD_GOVERNOR_DRIFT");
const result={status:"PINNED_PRODUCTION_GOVERNOR_BOUNDARY_PASS", sourceCommit:"e1b58060d6263a3af7ced51bec854d3e211d2f35",
 originalSource:"lib/disdex-integrated-gross-governor.ts::resolveIntegratedGrossGovernor",
 rows:decisions,q102:{belowOrEqualP030:g1,overP030:g2,stale:g3},
 testOnlySyntheticCapital:true,actualHistoricalNavReplayCompleted:false,
 actualHistoricalOrderbookAvailableBalanceVerified:false,
 fullFiveLogicBTCompleted:false,ordersSent:0};
fs.mkdirSync(".research-state/native-original-governor",{recursive:true});
fs.writeFileSync(".research-state/native-original-governor/result.json",JSON.stringify(result,null,2)+"\n");
console.log(result.status,crypto.createHash("sha256").update(JSON.stringify(result)).digest("hex"),JSON.stringify(decisions));
