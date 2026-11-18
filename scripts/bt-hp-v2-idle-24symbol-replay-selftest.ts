import assert from "node:assert/strict";
import {auditSyntheticFeed} from "../lib/bt-verification/synthetic-feed-audit";
import {createMultiassetH48Replay} from "../lib/bt-verification/multiasset-h48-replay";
import {validateReplay} from "../lib/bt-verification/replay";

const v1Audit=auditSyntheticFeed(123,"trend",168);
const v2Audit=auditSyntheticFeed(123,"trend",168,"v2");
assert.equal(v1Audit.feedVersion,"v1");
assert.equal(v2Audit.feedVersion,"v2");
assert.equal(v1Audit.totalSymbols,23);
assert.equal(v2Audit.totalSymbols,24);
assert.equal(v1Audit.cryptoSymbols,15);
assert.equal(v2Audit.cryptoSymbols,16);
assert.equal(v2Audit.stockSymbols,8);
assert.equal(v1Audit.ticks,v2Audit.ticks);
assert.equal(v1Audit.nativeRunnerDecisionReady,false);
assert.equal(v2Audit.nativeRunnerDecisionReady,false);
assert.notDeepEqual(v1Audit,v2Audit,"Different feed version cannot be treated as same market");
const one=createMultiassetH48Replay(1,"trend",10,"v1");
const two=createMultiassetH48Replay(1,"trend",10,"v2");
assert.equal(validateReplay(one),true);
assert.equal(validateReplay(two),true);
assert.equal(one.frames.length,2880);
assert.equal(two.frames.length,2880);
assert.equal(one.mode,"DEMO");
assert.equal(two.mode,"DEMO");
assert.ok(one.engineSha.includes("23SYM_V1"));
assert.ok(two.engineSha.includes("24SYM_V2"));
assert.equal(one.source?.kind,"SYNTHETIC_MULTI_ASSET_H48_CANDIDATE");
assert.equal(two.source?.kind,"SYNTHETIC_MULTI_ASSET_H48_CANDIDATE");
assert.ok(one.source?.note?.includes("without TIA (v1)"));
assert.ok(two.source?.note?.includes("including TIA (v2)"));
const tiaEvents=(r:typeof one)=>r.frames.flatMap(x=>x.events.filter(e=>e.includes("RISK IDLE_NATIVE_TIAUSDT")));
const eventsV1=tiaEvents(one),eventsV2=tiaEvents(two);
assert.equal(eventsV1.length,240);
assert.equal(eventsV2.length,240);
assert.ok(eventsV1.every(e=>e.includes("status=MISSING_SYMBOL")&&e.endsWith("NO_FILL")));
assert.ok(eventsV2.every(e=>!e.includes("status=MISSING_SYMBOL")&&e.endsWith("NO_FILL")),
 "V2 TIA native source must actually have completed H1 inputs");
assert.ok(eventsV2.some(e=>e.includes("status=NATIVE_REJECTED")||e.includes("status=RESEARCH_PRELIMINARY_PASSED")),
 "Native TIA must be evaluated, not just display a fake PASS");
assert.ok(two.frames.every(x=>x.positions.every(p=>p.symbol!=="TIAUSDT")),
 "Pure TIA signal cannot create even a synthetic position");
const v2Other=createMultiassetH48Replay(1,"trend",10,"v2");
assert.deepEqual(two,v2Other,"v2 deterministic replay reproduction by seed");
console.log("PASS two versioned OHLCV feeds: 23-symbol original immutable, 24-symbol TIA native shadow without fills",JSON.stringify({
 oldTiaMissing:eventsV1.length,newTiaNativeEvaluated:eventsV2.length,
 oneEquity:one.frames.at(-1)?.equity,twoEquity:two.frames.at(-1)?.equity,
 newHasNoTiaFills:true,
 sameResearchModelSource:true
}));
