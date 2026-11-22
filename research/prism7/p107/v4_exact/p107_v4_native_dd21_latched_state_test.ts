import * as fs from "node:fs";
import {createProductionState,applyProductionEvent,productionSnapshot} from "./v4-pin-source-e788abc8/lib/v12-v4-production-lifecycle";
import {V12_V4_MAXIMUM_DRAWDOWN} from "./v4-pin-source-e788abc8/config/v12V4AdoptionRiskPolicy";
const cases=[
 {name:"20pct",marks:[10000,8000],expectBlocked:false},
 {name:"21pct_exact",marks:[10000,7900],expectBlocked:false},
 {name:"21pct_plus",marks:[10000,7899],expectBlocked:true},
 {name:"22pct_then_full_rebound",marks:[10000,7800,10000],expectBlocked:true},
 {name:"new_peak_12500_then_22pct_retrace",marks:[10000,12500,9750],expectBlocked:true}
];
const results:any[]=[];
for(const c of cases){
 let state=createProductionState({equityUsd:c.marks[0],foreign:[],holdProtected:false});
 for(let i=1;i<c.marks.length;i++){
  state=applyProductionEvent(state,{type:"ACCOUNT_MARK",eventId:"M"+i,ts:i*1000,equityUsd:c.marks[i],prices:{}});
 }
 const dd=state.maxDrawdown;
 const held=state.initial.holdProtected||Boolean(state.executionReview)||dd>V12_V4_MAXIMUM_DRAWDOWN+1e-12;
 if(held!==c.expectBlocked)throw Error("V4_DD21_GUARD_MISMATCH:"+c.name+":"+dd);
 results.push({scenario:c.name,equityMarks:c.marks,finalEquity:state.equityUsd,equityPeak:state.equityPeakUsd,latchedMaximumDDPct:dd*100,sharedReservationsDd21Hold:held,sourcePortfolioGross:productionSnapshot(state).gross});
}
const check=results.find(r=>r.scenario==="22pct_then_full_rebound");
if(check?.finalEquity!==10000||!check.sharedReservationsDd21Hold)throw Error("DD_AUTOMATIC_REARM_UNEXPECTED");
const out={schema:"p107-v4-pinned-dd21-native-journal-hold-rearm-test/v1",sourceSha:"e788abc82e80f9fc7ab0e1ba83fdb8be267eb513",riskThresholdPct:V12_V4_MAXIMUM_DRAWDOWN*100,riskReservationCode:"lib/v12-v4-shared-reservations.ts:74",stateJournalSourceCode:"lib/v12-v4-production-lifecycle.ts:212-220",note:"In this pinned code, a max drawdown >21% persists in cumulative state.maxDrawdown even after later equity recovery; shared reservation fails closed. Re-arming needs an external formally defined and approved reset, not a BT auto-unlock.",realVPSStateTouched:false,venueOrderCount:0,fullSTABLE4BT:false,tests:results};
fs.writeFileSync(process.argv[2],JSON.stringify(out,null,2)+"\n");
console.log(JSON.stringify({PASS:true,thresholdPct:21,scenarioCount:results.length,allExpected:true,fullyRecoveredStillHeld:check.sharedReservationsDd21Hold}));
