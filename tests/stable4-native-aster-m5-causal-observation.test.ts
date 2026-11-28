import test from "node:test";
import assert from "node:assert/strict";
import {observeStable4ClosedAsterM5,type ClosedAsterM5Bar,type H1NativeCandidate} from "../lib/stable4-native-aster-m5-causal-observation";
import type {SourceObservation} from "../lib/stable4-native-pengu-q102-source-observer";

const H=3_600_000,M5=300_000,t=5_000*H;
const sha="a".repeat(40),archive="b".repeat(64),archive2="c".repeat(64);
const candidate:H1NativeCandidate={
 sleeve:"PENGU",symbol:"PENGUUSDT",side:"SHORT",route:"SHORT_V20",gross:1,
 entryTs:t,sourceReleaseSha:sha,sourceDecisionTs:t,sourceComplete:true,
};
const source:SourceObservation={
 status:"NATIVE_ENTRY_OBSERVED",reason:"NATIVE_H1_SIGNAL_ONLY_M5_UNCONFIRMED",
 runner:"PENGU",symbol:"PENGUUSDT",side:-1,
 decisionTs:t,sourceDataCutoffTs:t-H,sourcePin:sha,gross:1,route:"SHORT_V20",
 orderAuthority:false,asterM5EntryConfirmed:false,
};
const bar=(i:number,volume=100):ClosedAsterM5Bar=>({
 symbol:"PENGUUSDT",openTime:t+i*M5,closeTime:t+(i+1)*M5-1,
 open:100,high:101,low:99,close:100.5,volume,trades:volume===0?0:3,
 archiveSha256:archive,
});
const five=(extra:Record<string,unknown>={})=>observeStable4ClosedAsterM5({
 candidate,h1Observation:source,observedAtMs:t+M5,windowMinutes:5,
 venue:"ASTER_PUBLIC_KLINES",archivePins:[archive],bars:[bar(0)],...extra,
} as any);
const fifteen=(extra:Record<string,unknown>={})=>observeStable4ClosedAsterM5({
 candidate,h1Observation:source,observedAtMs:t+3*M5,windowMinutes:15,
 venue:"ASTER_PUBLIC_KLINES",archivePins:[archive],bars:[bar(0),bar(1),bar(2)],...extra,
} as any);
test("H1 native PENGU is only observational after its first ASTER M5 candle CLOSE",()=>{
 const before=five({observedAtMs:t+M5-1});
 assert.equal(before.reason,"ASTER_M5_WINDOW_NOT_CLOSED");
 assert.equal(before.fullWindowClosed,false);
 const x=five();
 assert.equal(x.status,"M5_TAPE_OBSERVED_ONLY");
 assert.equal(x.reason,"ASTER_M5_POSITIVE_VOLUME_NOT_VENUE_FILL_PROOF");
 assert.equal(x.nativeH1Bound,true);
 assert.equal(x.fullWindowClosed,true);
 assert.equal(x.positiveVolumeBars,1);
 assert.equal(x.allBarsPositiveVolume,true);
 assert.equal(x.eligibleForPortfolioEntry,false);
 assert.equal(x.venueFillCertified,false);
 assert.equal(x.executablePriceCertified,false);
 assert.equal(x.orderAuthority,false);
 assert.equal(five({observedAtMs:t+2*M5}).reason,"ASTER_M5_CONFIRMATION_STALE");
});
test("15m confirmation must await all three CLOSED and properly-ordered M5 bars",()=>{
 assert.equal(fifteen({observedAtMs:t+3*M5-1}).reason,"ASTER_M5_WINDOW_NOT_CLOSED");
 const result=fifteen();
 assert.equal(result.positiveVolumeBars,3);
 assert.equal(result.allBarsPositiveVolume,true);
 assert.equal(result.orderAuthority,false);
 assert.equal(fifteen({bars:[bar(0),bar(1)]}).reason,"ASTER_M5_REQUIRED_CANDLES_MISSING");
 assert.equal(fifteen({bars:[bar(0),bar(1),bar(1)]}).reason,"ASTER_M5_SOURCE_BAR_OR_SYMBOL_INVALID");
 assert.equal(fifteen({bars:[bar(0),bar(1),{...bar(2),openTime:t+4*M5}]}).reason,"ASTER_M5_SOURCE_BAR_OR_SYMBOL_INVALID");
 assert.equal(fifteen({observedAtMs:t+4*M5}).reason,"ASTER_M5_CONFIRMATION_STALE");
});
test("all-zero and partially-zero volume remain NO executable entry/fill proof",()=>{
 let x=five({bars:[bar(0,0)]});
 assert.equal(x.status,"M5_TAPE_OBSERVED_ONLY");
 assert.equal(x.reason,"ASTER_M5_ALL_ZERO_VOLUME_NO_EXECUTION_PROOF");
 assert.equal(x.positiveVolumeBars,0);
 x=fifteen({bars:[bar(0,0),bar(1),bar(2,0)]});
 assert.equal(x.reason,"ASTER_M5_PARTIAL_VOLUME_NO_EXECUTION_PROOF");
 assert.equal(x.positiveVolumeBars,1);
 assert.equal(x.allBarsPositiveVolume,false);
 assert.equal(x.orderAuthority,false);
 assert.equal(fifteen({bars:[bar(0,0),bar(1,0),bar(2,0)]}).reason,"ASTER_M5_ALL_ZERO_VOLUME_NO_EXECUTION_PROOF");
});
test("Q102 native candidate may be observed only for its exact symbol/route/source",()=>{
 const q:{candidate:H1NativeCandidate;source:SourceObservation}={
 candidate:{...candidate,sleeve:"Q102",symbol:"SOLUSDT",route:"HIGH_VOL|SOLUSDT",side:"LONG",gross:.5},
 source:{...source,runner:"Q102",symbol:"SOLUSDT",route:"HIGH_VOL|SOLUSDT",side:1,gross:.5},
 };
 const sourceBar={...bar(0),symbol:"SOLUSDT"};
 const good=five({candidate:q.candidate,h1Observation:q.source,bars:[sourceBar]});
 assert.equal(good.status,"M5_TAPE_OBSERVED_ONLY");
 assert.equal(good.orderAuthority,false);
 assert.equal(five({candidate:q.candidate,h1Observation:q.source}).reason,"ASTER_M5_SOURCE_BAR_OR_SYMBOL_INVALID");
 assert.equal(five({candidate:q.candidate,h1Observation:{...q.source,sourcePin:"f".repeat(40)},bars:[sourceBar]}).reason,"NATIVE_H1_SOURCE_BINDING_NOT_PROVEN");
 assert.equal(five({candidate:q.candidate,h1Observation:{...q.source,orderAuthority:true as any},bars:[sourceBar]}).reason,"NATIVE_H1_SOURCE_BINDING_NOT_PROVEN");
});
test("reject bar substitution, source SHA fraud, future/non-causal tape and impossible OHLC",()=>{
 const brokenBars=[
  {...bar(0),symbol:"ETHUSDT"},
  {...bar(0),archiveSha256:archive2},
  {...bar(0),openTime:t-M5},
  {...bar(0),closeTime:t+M5},
  {...bar(0),low:101},
  {...bar(0),high:100},
  {...bar(0),volume:-1},
  {...bar(0),volume:0,trades:3},
  {...bar(0),volume:100,trades:0},
  {...bar(0),open:Number.NaN},
  {...bar(0),trades:1.5},
 ];
 for(const fake of brokenBars)
  assert.equal(five({bars:[fake]}).reason,"ASTER_M5_SOURCE_BAR_OR_SYMBOL_INVALID");
 assert.equal(five({archivePins:["not-a-sha"]}).reason,"ASTER_M5_PROVENANCE_UNVERIFIED");
 assert.equal(five({archivePins:[archive,archive]}).reason,"ASTER_M5_PROVENANCE_UNVERIFIED");
 assert.equal(five({venue:"SOME_OTHER_EXCHANGE"}).reason,"ASTER_M5_PROVENANCE_UNVERIFIED");
 assert.equal(five({observedAtMs:t+M5-1}).orderAuthority,false);
 assert.equal(five({windowMinutes:10}).reason,"ASTER_M5_PROVENANCE_UNVERIFIED");
});
test("separate reviewed source archive pins may cross month boundary but do not certify fills",()=>{
 const result=fifteen({archivePins:[archive,archive2],bars:[bar(0),bar(1),{...bar(2),archiveSha256:archive2}]});
 assert.equal(result.status,"M5_TAPE_OBSERVED_ONLY");
 assert.equal(result.positiveVolumeBars,3);
 assert.equal(result.venueFillCertified,false);
 assert.equal(fifteen({archivePins:[archive],bars:[bar(0),bar(1),{...bar(2),archiveSha256:archive2}]}).status,"BLOCKED");
});
