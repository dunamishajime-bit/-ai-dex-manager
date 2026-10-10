/** Read-only release handoff verifier. Does not issue orders or install certificates. */
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {PRODUCTION_EXIT_CATALOG} from "../lib/v12-v4-production-lifecycle";
const ROOT=process.cwd();
const evidencePath=join(ROOT,"docs/ops/v12-v4-cert-20261009");
const exact=(name:string)=>JSON.parse(readFileSync(join(evidencePath,name),"utf8"));
function check(name:string,pass:boolean,details:Record<string,unknown>){
 return {name,status:pass?"PASS":"BLOCKED",...details};
}
const ext=exact("native-route-parity-after.json");
const extExit=exact("native-route-exit-parity.json");
const historical=exact("historical-sixteen-independent-replay.json");
const historicalExit=exact("historical-sixteen-independent-exit.json");
const external=new Set<string>(ext.actual.map((x:{route:string})=>x.route));
const historic=new Set<string>(historical.byRoute.map((x:{route:string})=>x.route));
const historicalExitRoutes=new Set<string>(historicalExit.byRoute.map((x:{route:string})=>x.route));
const full=new Set(PRODUCTION_EXIT_CATALOG.map(x=>x.route));
const coverage=check("41-route identity and two disjoint research cohorts",
 full.size===41&&external.size===25&&historic.size===16&&
  [...historic].every(r=>!external.has(r)&&historicalExitRoutes.has(r)&&full.has(r))&&
  [...external].every(r=>full.has(r)),{
 catalogRoutes:full.size,externalSampleRoutes:external.size,
 historicalSupplementRoutes:historic.size,
 independentExternalForAll41:false,
 });
const historicEntry=check("16 historical source/Entry/rank/Gross replay",
 historical.status==="PASS_HISTORICAL_SIXTEEN_IN_SAMPLE_SOURCE_AND_ENTRY"&&
  historical.matchedTrades===212&&historical.expectedTrades===212,{
 matched:historical.matchedTrades,expected:historical.expectedTrades,
 });
const historicExited=check("16 historical independent H1 Exit price-model replay",
 historicalExit.status==="PASS_SIXTEEN_HISTORICAL_H1_EXIT_PRICE_MODEL"&&
  historicalExit.matched===212&&historicalExit.expected===212,{
 matched:historicalExit.matched,expected:historicalExit.expected,
 });
const externalCheck=check("25 external routes historical signed-source replay",
 ext.status==="PASS_NATIVE_ROUTE_ENTRY_REPLAY"&&
  ext.actualCount===258&&ext.expectedCount===258&&
  extExit.matching===258&&extExit.expected===258,{
 externalRoutes:external.size,entryMatches:ext.actualCount,exitMatches:extExit.matching,
 });
const remaining=[
 "41/41 independent unseen-period coverage is not observed (16 historically verified only)",
 "Independent Aster lifecycle evidence is not yet certified. Testnet is optional: use Aster Testnet, authentic Production history, or a controlled Production canary; mock-only proof is forbidden",
 "Root-managed release-bound TIME37 emergency STOP policy requires separate operator approval",
 "Root-managed 41-route production certificate and real-money operator acknowledgement not installed",
 "Fresh broker Gross/Kill/Margin/peer state/old V12 stop/restart/rollback must be verified by Codex",
 "External-period weak PF / Y06 underperformance remains an operator adoption decision",
];
const report={
 status:"CUTOVER_BLOCKED_UNTIL_VERIFIED",
 orderEnabled:false,realOrderEnabledV4:0,tradingMutation:0,
 generatedAt:new Date().toISOString(),checks:[coverage,historicEntry,historicExited,externalCheck],
 testnetMandatory:false,allowedVenueEvidenceModes:["ASTER_TESTNET","AUTHENTIC_PRODUCTION_HISTORY","CONTROLLED_PRODUCTION_CANARY"],
 independentRealVenueCertificate:false,releaseOperatorAuthorization:false,
 remaining,
};
console.log(JSON.stringify(report,null,2));
// A research-only PASS is not a Production cutover pass. Unconditionally
// signal blocked until the independently signed venue/Operator gates exist.
if(report.remaining.length||report.checks.some(x=>x.status!=="PASS"))
 process.exitCode=2;
