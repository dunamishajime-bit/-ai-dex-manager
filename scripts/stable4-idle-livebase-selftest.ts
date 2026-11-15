import assert from "node:assert/strict";
import { DISDEX_STABLE4_OPPORTUNITY, assertStable4GlobalLiveAck } from "../config/disdexStable4Opportunity";
import { stable4IdleBlocks, stable4IdleTaoRiskOffUntil } from "../lib/disdex-stable4-idle";

const H=3_600_000;
const ts=1_800_000_000_000;
assert.equal(DISDEX_STABLE4_OPPORTUNITY.idle.renderWait,true);
assert.equal(DISDEX_STABLE4_OPPORTUNITY.idle.taoRiskOffHours,12);
assert.equal(DISDEX_STABLE4_OPPORTUNITY.portfolio.cryptoGrossCap,3);
assert.equal(DISDEX_STABLE4_OPPORTUNITY.portfolio.stockGrossCap,1.5);
assert.equal(DISDEX_STABLE4_OPPORTUNITY.portfolio.totalGrossCap,3.5);

assert.equal(stable4IdleBlocks("OFF","RENDERUSDT",ts,0),false);
assert.equal(stable4IdleBlocks("SHADOW","RENDERUSDT",ts,0),false);
assert.equal(stable4IdleBlocks("LIVE","RENDERUSDT",ts,0),true);

assert.equal(stable4IdleTaoRiskOffUntil("OFF",ts,true,0),0);
const shadowUntil=stable4IdleTaoRiskOffUntil("SHADOW",ts,true,0);
assert.equal(shadowUntil-ts,12*H);
assert.equal(stable4IdleBlocks("SHADOW","TIAUSDT",ts+1,shadowUntil),false);
const liveUntil=stable4IdleTaoRiskOffUntil("LIVE",ts,true,0);
assert.equal(liveUntil-ts,12*H);
assert.equal(stable4IdleBlocks("LIVE","TIAUSDT",ts+1,liveUntil),true);
assert.equal(stable4IdleBlocks("LIVE","TIAUSDT",liveUntil,liveUntil),false);

const sha="a".repeat(40);
assert.doesNotThrow(()=>assertStable4GlobalLiveAck("LIVE",sha,{DISDEX_STABLE4_GLOBAL_LIVE_ACK:sha}));
assert.throws(()=>assertStable4GlobalLiveAck("LIVE",sha,{DISDEX_STABLE4_GLOBAL_LIVE_ACK:"b".repeat(40)}));
console.log("STABLE4_IDLE_LIVEBASE_SELFTEST_PASS");