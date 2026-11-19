import test from "node:test";
import assert from "node:assert/strict";
import {compareStudyPinsWithObservedVps, type ObservedPinSnapshot} from "../lib/bt-verification/source-pin-compat";
import type {StrategyCatalogEntry} from "../lib/bt-verification/replay";

const sha=(ch:string)=>ch.repeat(40);
const sample=(logic:string,sourceRuntimeShas:string[]):StrategyCatalogEntry=>({
 logic,trades:5,sourceRuntimeShas,modelClasses:[],routes:1,symbols:1,status:"RESEARCH_SOURCE_UNVERIFIED",
});
const evidence:ObservedPinSnapshot={
 schema:"disdex-bt-vps-entrypoint-parity/v1",observed_utc:"2026-11-18T22:07:32Z",
 all_entrypoints_verified:true,
 rows:["V4","HYPE","Q102","V52","FET","IDLE","PENGU","SharedRisk"].map(x=>({
 runner:x,git_commit:sha(x==="V4"?"a":"b"),verified:true,
 })),
};

test("research SHA mismatch is explicitly not production parity",()=>{
 const x=compareStudyPinsWithObservedVps([sample("V4",[sha("c")])],evidence)[0];
 assert.equal(x.status,"RESEARCH_SOURCE_DIFFERS");
 assert.equal(x.observedSha,sha("a"));
});

test("matching source SHA never certifies backtest result",()=>{
 const x=compareStudyPinsWithObservedVps([sample("Q102",[sha("b")])],evidence)[0];
 assert.equal(x.status,"SHA_MATCH_NOT_PARITY");
});

test("unverified and duplicate evidence fail closed",()=>{
 const a={...evidence,rows:evidence.rows.map(x=>({...x}))};
 a.rows[0].verified=false;
 assert.equal(compareStudyPinsWithObservedVps([sample("V4",[sha("a")])],a)[0].status,"NO_TRUSTED_OBSERVATION");
 const b={...evidence,rows:evidence.rows.map(x=>({...x}))};
 b.rows[1].runner="V4";
 assert.equal(compareStudyPinsWithObservedVps([sample("V4",[sha("a")])],b)[0].status,"NO_TRUSTED_OBSERVATION");
});

test("unknown strategy and malformed SHAs cannot match",()=>{
 assert.equal(compareStudyPinsWithObservedVps([sample("OTHER",[sha("b")])],evidence)[0].status,"NO_TRUSTED_OBSERVATION");
 assert.equal(compareStudyPinsWithObservedVps([sample("V4",["junk"])],evidence)[0].status,"NO_TRUSTED_OBSERVATION");
});
