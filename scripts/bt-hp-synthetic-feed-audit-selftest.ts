import assert from "node:assert/strict";
import {auditSyntheticFeed} from "../lib/bt-verification/synthetic-feed-audit";
const a=auditSyntheticFeed(11,"volatile",168);
assert.equal(a.hours,168);assert.equal(a.ticks,2016);
assert.equal(a.cryptoSymbols,15);assert.equal(a.stockSymbols,8);assert.equal(a.totalSymbols,23);
assert.equal(a.btcClosedH1,168);assert.equal(a.hypeClosedH1,168);
assert.equal(a.nativeRunnerDecisionReady,false);
assert.ok(a.btcMax>a.btcMin&&a.hypeMax>a.hypeMin);
assert.ok(a.fundingEvents>0);
assert.ok(a.blockers.some(x=>x.includes("Q102 Online")));
assert.deepEqual(a,auditSyntheticFeed(11,"volatile",168),"Audit stable under same seed and inputs");
assert.notDeepEqual(a,auditSyntheticFeed(12,"volatile",168),"Seed changes price paths");
assert.throws(()=>auditSyntheticFeed(11,"range",0),/INVALID/);
assert.throws(()=>auditSyntheticFeed(11,"range",169),/INVALID/);
assert.throws(()=>auditSyntheticFeed(-7,"range",168),/INVALID/);
console.log("PASS bt-hp 7-day synthetic market input audit",JSON.stringify({
 ticks:a.ticks,symbols:a.totalSymbols,hours:a.hours,funding:a.fundingEvents,
 native:a.nativeRunnerDecisionReady}));
