import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {
 inspectQ102HvClosedTradeMonth,
 type Q102HvClosedResearchLedger,
 type Q102HvClosedResearchTrade
} from "../lib/bt-verification/q102-highvol-closed-ledger-monthly";
import {
 selectQuality102HighVolMonthlyRule,quality102HighVolRuleKey,
 QUALITY102_DAY_MS,QUALITY102_HOUR_MS
} from "../lib/bt-verification/pinned-native-q102/disdex-quality102-causal-pipeline";

const native=readFileSync(join(process.cwd(),"lib","bt-verification",
 "pinned-native-q102","disdex-quality102-causal-pipeline.ts"));
const source=Buffer.from(native.toString("utf8")
 .split(String.fromCharCode(13,10)).join(String.fromCharCode(10))
 .split(String.fromCharCode(10)).join(String.fromCharCode(13,10)));
assert.equal(createHash("sha256").update(source).digest("hex"),
 "7483c4ca504320ff9b4f06479c84418604d1b310aeeaa6c3574ae8ca5285ab8f");
const monthStart=Date.parse("2026-03-01T00:00:00Z");
const start=monthStart-180*QUALITY102_DAY_MS,end=monthStart-QUALITY102_HOUR_MS;
const good={longDrop:.08,longRsi:30,shortRally:.05,shortRsi:55,hardStop:.1};
const bad={longDrop:.12,longRsi:35,shortRally:.08,shortRsi:60,hardStop:.15};
function row(i:number,rule:typeof good,netReturn:number,kind:string):Q102HvClosedResearchTrade{
 const open=start+(i*15+1)*QUALITY102_DAY_MS;
 return {id:kind+"-"+i,rule,openedAtMs:open,closedAtMs:open+2*QUALITY102_HOUR_MS,
 netReturn};
}
const goodTrades=Array.from({length:8},(_,i)=>
 row(i,good,i<6?.02:-.015,"good"));
const badTrades=Array.from({length:8},(_,i)=>
 row(i,bad,i<3?.02:-.03,"bad"));
const ledger:Q102HvClosedResearchLedger={
 kind:"ISOLATED_RESEARCH_COMPLETED_TRADES",
 windowStartMs:start,windowEndMs:end,
 rows:[...goodTrades,...badTrades]
};
const noSource=inspectQ102HvClosedTradeMonth(monthStart,null);
assert.equal(noSource.sourceOutcome,"MISSING_COMPLETED_LEDGER");
assert.equal(noSource.nativeMonthlyRuleSelectedForResearch,false);
assert.equal(noSource.liveEntryEnabled,false);
assert.equal(noSource.fills,0);
const selection=inspectQ102HvClosedTradeMonth(monthStart,ledger);
assert.equal(selection.sourceOutcome,"SELECTED_RESEARCH_ONLY");
assert.equal(selection.closedTradesEvaluated,16);
assert.equal(selection.rulesEvaluated,2);
assert.equal(selection.nativeMonthlyRuleSelectedForResearch,true);
assert.equal(selection.selectedRuleKey,quality102HighVolRuleKey(good));
assert.equal(selection.verifiedStageMembership,false);
assert.equal(selection.liveEntryEnabled,false);
assert.equal(selection.fills,0);
const nativeSuccess=selectQuality102HighVolMonthlyRule({monthStartTs:monthStart,
 evaluations:[{
   rule:good,trades:8,wins:6,totalReturn:.09,profitFactor:4,
   expectancy:.01125,maxDrawdown:-.04,
   trainingStartTs:start,trainingEndTs:end,
   availableAtTs:goodTrades[7].closedAtMs!
 }]});
assert.ok(nativeSuccess.selected);
assert.equal(nativeSuccess.selected?.ruleKey,selection.selectedRuleKey);
const missingMin=inspectQ102HvClosedTradeMonth(monthStart,{...ledger,rows:goodTrades.slice(0,4)});
assert.equal(missingMin.sourceOutcome,"MISSING_MINIMUM_SAMPLE");
assert.equal(missingMin.selectedRuleKey,null);
const loses=inspectQ102HvClosedTradeMonth(monthStart,{...ledger,rows:badTrades});
assert.equal(loses.sourceOutcome,"MISSING_MINIMUM_SAMPLE");
assert.equal(loses.liveEntryEnabled,false);
assert.throws(()=>inspectQ102HvClosedTradeMonth(monthStart+QUALITY102_HOUR_MS,ledger),
 /QUALITY102_INVALID_MONTH_START/);
assert.throws(()=>inspectQ102HvClosedTradeMonth(monthStart,{
 ...ledger,windowStartMs:start+QUALITY102_DAY_MS
}),/EXACT_180D/);
assert.throws(()=>inspectQ102HvClosedTradeMonth(monthStart,{
 ...ledger,windowEndMs:monthStart
}),/EXACT_180D/);
assert.throws(()=>inspectQ102HvClosedTradeMonth(monthStart,{
 ...ledger,rows:[goodTrades[0],goodTrades[0]]
}),/DUPLICATE_OR_MISSING/);
assert.throws(()=>inspectQ102HvClosedTradeMonth(monthStart,{
 ...ledger,rows:[{...goodTrades[0],closedAtMs:null}]
}),/FUTURE_OR_OPEN/);
assert.throws(()=>inspectQ102HvClosedTradeMonth(monthStart,{
 ...ledger,rows:[{...goodTrades[0],closedAtMs:monthStart+QUALITY102_HOUR_MS}]
}),/FUTURE_OR_OPEN/);
assert.throws(()=>inspectQ102HvClosedTradeMonth(monthStart,{
 ...ledger,rows:[{...goodTrades[0],openedAtMs:start-QUALITY102_HOUR_MS}]
}),/FUTURE_OR_OPEN/);
assert.throws(()=>inspectQ102HvClosedTradeMonth(monthStart,{
 ...ledger,rows:[{...goodTrades[0],netReturn:-1}]
}),/INVALID_REALIZED_RETURN/);
assert.throws(()=>inspectQ102HvClosedTradeMonth(monthStart,{
 ...ledger,rows:[{...goodTrades[0],rule:{...good,longDrop:.079}}]
}),/RULE_OUTSIDE_GRID/);
assert.deepEqual(selection,inspectQ102HvClosedTradeMonth(monthStart,ledger),
 "Same frozen closed trades must produce identical native monthly rule selection");
console.log("PASS Q102 native 180d source selector: 16 engineered CLOSED research rows, exact 180d coverage, 1 eligible rule, 1 rejected, no lookahead, duplicates/open/future rejected, zero entries/fills");
