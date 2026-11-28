import test from "node:test";
import assert from "node:assert/strict";
import {QUALITY102_CAUSAL_V1} from "../config/disdexQuality102CausalV1Runtime";
import {quality102GrossForFamily,INTEGRATED_PRODUCTION_RISK_POLICY} from "../config/integratedProductionRiskPolicy";
import {HYPE_TREND_LONG_POLICY} from "../config/hypeTrendLongPolicy";
import {calculateWalletRiskStop,moreProtectiveStop} from "../lib/disdex-exit-overlay-contract";
test("Q102 V4 HIGH_VOL must not inherit V1 generic three-times maximum",()=>{
 assert.equal(QUALITY102_CAUSAL_V1.maximumGross,3);
 assert.equal(quality102GrossForFamily("HIGH_VOL",1),1);
 assert.equal(quality102GrossForFamily("HIGH_VOL",-1),.6);
 assert.ok(quality102GrossForFamily("HIGH_VOL",1)<=INTEGRATED_PRODUCTION_RISK_POLICY.cryptoGrossCap);
 assert.ok(quality102GrossForFamily("HIGH_VOL",-1)<=INTEGRATED_PRODUCTION_RISK_POLICY.cryptoGrossCap);
 assert.throws(()=>quality102GrossForFamily("HIGH_VOL"),/SIDE_GROSS_REQUIRED/);
});
test("HYPE TREND native wallet STOP is more protective than ATR STOP when necessary",()=>{
 const equity=10000,entry=100,acceptedGross=HYPE_TREND_LONG_POLICY.maximumGross;
 const wallet=calculateWalletRiskStop({side:"LONG",entryPrice:entry,equity,acceptedGross,walletRiskPct:2,roundTripCostBps:30});
 const atrStop=entry-10;
 const effective=moreProtectiveStop("LONG",atrStop,wallet.stopPrice);
 assert.ok(effective>=atrStop&&effective<entry);
 assert.ok(equity*acceptedGross*(1-effective/entry)+equity*acceptedGross*.003<=200.01);
});
